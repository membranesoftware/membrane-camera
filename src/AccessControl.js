/*
* Copyright 2019 Membrane Software <author@membranesoftware.com>
*                 https://membranesoftware.com
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
const Result = require (App.SOURCE_DIRECTORY + "/Result");
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const SystemInterface = require (App.SOURCE_DIRECTORY + "/SystemInterface");
const RepeatTask = require (App.SOURCE_DIRECTORY + "/RepeatTask");

class AccessControl {
	constructor () {
		this.sessionMap = { };
		this.updateTask = new RepeatTask ();
	}

	// Start the access control's operations
	start () {
		this.updateTask.setRepeating ((callback) => {
			this.update (callback);
		}, App.HEARTBEAT_PERIOD * 4, App.HEARTBEAT_PERIOD * 8);
	}

	// Stop the access control's operations
	stop () {
		this.updateTask.stop ();
		this.sessionMap = { };
	}

	// Update access control data as appropriate for current state and invoke the provided callback when complete
	update (endCallback) {
		let now, keys, session;

		now = new Date ().getTime ();
		keys = Object.keys (this.sessionMap);
		for (let key of keys) {
			session = this.sessionMap[key];
			if ((session.sustainCount <= 0) && ((now - session.updateTime) >= App.AUTHORIZE_SESSION_DURATION)) {
				delete (this.sessionMap[key]);
			}
		}
		process.nextTick (endCallback);
	}

	// Create a new authorization session using the provided Authorize command and return a response command
	authorize (cmdInv) {
		let hash, auth, token;

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
		if (cmdInv.params.token.length < App.AUTHORIZE_TOKEN_LENGTH) {
			return (SystemInterface.createCommand ({ }, "CommandResult", SystemInterface.Constant.DefaultCommandType, {
				success: false,
				error: "Authorization failed"
			}));
		}

		hash = Crypto.createHash (SystemInterface.Constant.AuthorizationHashAlgorithm);
		auth = SystemInterface.getCommandAuthorizationHash (cmdInv, App.AUTHORIZE_SECRET, null,
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

		token = this.createSession ();
		return (SystemInterface.createCommand (App.systemAgent.getCommandPrefix (), "AuthorizeResult", SystemInterface.Constant.DefaultCommandType, {
			token: token
		}));
	}

	isCommandAuthorized (cmdInv) {
		let session, hash, auth;

		if (typeof cmdInv.prefix[SystemInterface.Constant.AuthorizationHashPrefixField] != "string") {
			return (false);
		}
		if (typeof cmdInv.prefix[SystemInterface.Constant.AuthorizationTokenPrefixField] != "string") {
			return (false);
		}

		session = this.sessionMap[cmdInv.prefix[SystemInterface.Constant.AuthorizationTokenPrefixField]];
		if (session == null) {
			return (false);
		}

		// TODO: Possibly validate other prefix fields, such as create time

		hash = Crypto.createHash (SystemInterface.Constant.AuthorizationHashAlgorithm);
		auth = SystemInterface.getCommandAuthorizationHash (cmdInv, App.AUTHORIZE_SECRET, null,
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

		session.updateTime = new Date ().getTime ();
		return (true);
	}

	// Create a new entry in the session map and return the token value that was assigned
	createSession () {
		let token, now;

		while (true) {
			token = App.systemAgent.getRandomString (App.AUTHORIZE_TOKEN_LENGTH);
			if (this.sessionMap[token] == null) {
				break;
			}
		}

		now = new Date ().getTime ();
		this.sessionMap[token] = {
			createTime: now,
			updateTime: now,
			sustainCount: 0
		};
		return (token);
	}

	// Set the sustained state for the session referenced by the provided token. If enabled, the session does not expire by timeout.
	setSessionSustained (sessionToken, isSustained) {
		let session;

		if (typeof sessionToken != "string") {
			return;
		}

		session = this.sessionMap[sessionToken];
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

		session.updateTime = new Date ().getTime ();
	}
}
module.exports = AccessControl;
