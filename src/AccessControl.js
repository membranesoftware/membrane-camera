/*
* Copyright 2019-2020 Membrane Software <author@membranesoftware.com> https://membranesoftware.com
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice,
* this list of conditions and the following disclaimer.
*
* 2. Redistributions in binary form must reproduce the above copyright notice,
* this list of conditions and the following disclaimer in the documentation
* and/or other materials provided with the distribution.
*
* 3. Neither the name of the copyright holder nor the names of its contributors
* may be used to endorse or promote products derived from this software without
* specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
* AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
* IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
* ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
* LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
* CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
* SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
* INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
* CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
* ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
* POSSIBILITY OF SUCH DAMAGE.
*/
// Class that provides access control functions

"use strict";

const App = global.App || { };
const Crypto = require ("crypto");
const Path = require ("path");
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const RepeatTask = require (Path.join (App.SOURCE_DIRECTORY, "RepeatTask"));

class AccessControl {
	constructor () {
		this.sessionMap = { };
		this.updateTask = new RepeatTask ();
	}

	// Start the access control's operations
	start () {
		this.updateTask.setRepeating ((callback) => {
			this.update (callback);
		}, App.HeartbeatPeriod * 4, App.HeartbeatPeriod * 8);
	}

	// Stop the access control's operations
	stop () {
		this.updateTask.stop ();
		this.sessionMap = { };
	}

	// Update access control data as appropriate for current state and invoke the provided callback when complete
	update (endCallback) {
		const now = Date.now ();
		const keys = Object.keys (this.sessionMap);
		for (const key of keys) {
			const session = this.sessionMap[key];
			if ((session.sustainCount <= 0) && ((now - session.updateTime) >= App.AuthorizeSessionDuration)) {
				delete (this.sessionMap[key]);
			}
		}
		process.nextTick (endCallback);
	}

	// Create a new authorization session using the provided Authorize command and return a response command
	authorize (cmdInv) {
		if (cmdInv.command != SystemInterface.CommandId.Authorize) {
			return (SystemInterface.createCommand ({ }, "CommandResult", SystemInterface.Constant.DefaultCommandType, {
				success: false,
				error: "Authorization failed"
			}));
		}
		if (typeof cmdInv.prefix[SystemInterface.Constant.AuthorizationHashPrefixField] != "string") {
			return (SystemInterface.createCommand ({ }, "CommandResult", SystemInterface.Constant.DefaultCommandType, {
				success: false,
				error: "Authorization failed"
			}));
		}
		if (cmdInv.params.token.length < App.AuthorizeTokenLength) {
			return (SystemInterface.createCommand ({ }, "CommandResult", SystemInterface.Constant.DefaultCommandType, {
				success: false,
				error: "Authorization failed"
			}));
		}

		const hash = Crypto.createHash (SystemInterface.Constant.AuthorizationHashAlgorithm);
		const auth = SystemInterface.getCommandAuthorizationHash (cmdInv, App.AuthorizeSecret, null,
			(data) => {
				hash.update (data);
			},
			() => {
				return (hash.digest ("hex"));
			}
		);
		if (auth != cmdInv.prefix[SystemInterface.Constant.AuthorizationHashPrefixField]) {
			return (SystemInterface.createCommand ({ }, "CommandResult", SystemInterface.Constant.DefaultCommandType, {
				success: false,
				error: "Authorization failed"
			}));
		}

		const token = this.createSession ();
		return (SystemInterface.createCommand (App.systemAgent.getCommandPrefix (), "AuthorizeResult", SystemInterface.Constant.DefaultCommandType, {
			token: token
		}));
	}

	isCommandAuthorized (cmdInv) {
		if (typeof cmdInv.prefix[SystemInterface.Constant.AuthorizationHashPrefixField] != "string") {
			return (false);
		}
		if (typeof cmdInv.prefix[SystemInterface.Constant.AuthorizationTokenPrefixField] != "string") {
			return (false);
		}

		const session = this.sessionMap[cmdInv.prefix[SystemInterface.Constant.AuthorizationTokenPrefixField]];
		if (session == null) {
			return (false);
		}

		// TODO: Possibly validate other prefix fields, such as create time

		const hash = Crypto.createHash (SystemInterface.Constant.AuthorizationHashAlgorithm);
		const auth = SystemInterface.getCommandAuthorizationHash (cmdInv, App.AuthorizeSecret, null,
			(data) => {
				hash.update (data);
			},
			() => {
				return (hash.digest ("hex"));
			}
		);
		if (auth != cmdInv.prefix[SystemInterface.Constant.AuthorizationHashPrefixField]) {
			return (false);
		}

		session.updateTime = Date.now ();
		return (true);
	}

	// Create a new entry in the session map and return the token value that was assigned
	createSession () {
		let token;

		while (true) {
			token = App.systemAgent.getRandomString (App.AuthorizeTokenLength);
			if (this.sessionMap[token] == null) {
				break;
			}
		}

		const now = Date.now ();
		this.sessionMap[token] = {
			createTime: now,
			updateTime: now,
			sustainCount: 0
		};

		return (token);
	}

	// Set the sustained state for the session referenced by the provided token. If enabled, the session does not expire by timeout.
	setSessionSustained (sessionToken, isSustained) {
		if (typeof sessionToken != "string") {
			return;
		}

		const session = this.sessionMap[sessionToken];
		if (session == null) {
			return;
		}

		if (isSustained) {
			++(session.sustainCount);
		}
		else {
			--(session.sustainCount);
		}
		if (session.sustainCount < 0) {
			session.sustainCount = 0;
		}

		session.updateTime = Date.now ();
	}
}
module.exports = AccessControl;
