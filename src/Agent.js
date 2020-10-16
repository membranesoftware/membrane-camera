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
// Class that holds state for a remote system agent

"use strict";

const App = global.App || { };
const Path = require ("path");
const EventEmitter = require ("events").EventEmitter;
const Http = require ("http");
const Https = require ("https");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));

const UnauthorizedErrorMessage = "Unauthorized";

class Agent {
	constructor () {
		// Read-only data members
		this.agentId = "";
		this.version = "";
		this.displayName = "";
		this.applicationName = "";
		this.urlHostname = "";
		this.udpPort = 0;
		this.tcpPort1 = 0;
		this.tcpPort2 = 0;
		this.runCount = 0;
		this.maxRunCount = 0;
		this.isEnabled = false;
		this.createTime = Date.now ();
		this.lastStatus = { };
		this.lastStatusTime = 0;
		this.lastInvokeTime = 0;
		this.isInvoking = false;
		this.commandQueue = [ ];

		// Read-write data members
		this.authorizePath = "";
		this.authorizeSecret = "";
		this.authorizeToken = "";

		this.nextCommandId = 0;
		this.commandResolveEventEmitter = new EventEmitter ();
		this.commandResolveEventEmitter.setMaxListeners (0);
		this.commandRejectEventEmitter = new EventEmitter ();
		this.commandRejectEventEmitter.setMaxListeners (0);
	}

	// Return a string representation of the agent
	toString () {
		return (`<Agent id=${this.agentId} displayName=${this.displayName} urlHostname=${this.urlHostname} version=${this.version} runCount=${this.runCount}/${this.maxRunCount} authRequired=${this.authorizeSecret.length > 0} authToken=${this.authorizeToken} commandQueueSize=${this.commandQueue.length} invokeCount=${this.nextCommandId}>`);
	}

	// Update status with fields from an AgentStatus command
	updateStatus (statusCommand) {
		this.lastStatus = statusCommand.params;
		this.lastStatusTime = Date.now ();

		this.agentId = statusCommand.params.id;
		this.version = statusCommand.params.version;
		this.displayName = statusCommand.params.displayName;
		this.applicationName = statusCommand.params.applicationName;
		this.urlHostname = statusCommand.params.urlHostname;
		this.udpPort = statusCommand.params.udpPort;
		this.tcpPort1 = statusCommand.params.tcpPort1;
		this.tcpPort2 = statusCommand.params.tcpPort2;
		this.runCount = statusCommand.params.runCount;
		this.maxRunCount = statusCommand.params.maxRunCount;
		this.isEnabled = statusCommand.params.isEnabled;
	}

	// Return a promise that invokes a command on the agent in queued order. If responseCommandId is provided, the response command must match that type. If the command invocation succeeds, resolve with the response command.
	invokeCommand (invokePath, cmdInv, responseCommandId, authorizePath, authorizeSecret, authorizeToken) {
		if (SystemInterface.isError (cmdInv)) {
			return (Promise.reject (Error (`Invalid command: ${cmdInv}`)));
		}

		const commandid = this.nextCommandId;
		++(this.nextCommandId);
		this.lastInvokeTime = Date.now ();

		this.commandQueue.push ({
			id: commandid,
			invokePath: invokePath,
			cmdInv: cmdInv,
			responseCommandId: responseCommandId,
			authorizePath: authorizePath,
			authorizeSecret: authorizeSecret,
			authorizeToken: authorizeToken
		});
		if (! this.isInvoking) {
			setTimeout (() => {
				this.invokeNextCommand ().catch ((err) => {
					Log.debug (`AgentControl.invokeNextCommand failed; err=${err}`);
				});
			}, 0);
		}

		return (new Promise ((resolve, reject) => {
			this.commandResolveEventEmitter.once (`${commandid}`, (responseCommand) => {
				resolve (responseCommand);
			});
			this.commandRejectEventEmitter.once (`${commandid}`, (err) => {
				reject (err);
			});
		}));
	}

	// Execute the next item from commandQueue
	async invokeNextCommand () {
		let authpath, authsecret, authtoken, iscmdtoken;

		if (this.isInvoking || (this.commandQueue.length <= 0)) {
			return;
		}

		const cmd = this.commandQueue.shift ();
		this.lastInvokeTime = Date.now ();
		this.isInvoking = true;

		const endInvoke = () => {
			this.commandResolveEventEmitter.removeAllListeners (`${cmd.id}`);
			this.commandRejectEventEmitter.removeAllListeners (`${cmd.id}`);
			this.lastInvokeTime = Date.now ();
			this.isInvoking = false;
			if (this.commandQueue.length > 0) {
				this.invokeNextCommand ().catch ((err) => {
					Log.debug (`AgentControl.invokeNextCommand failed; err=${err}`);
				});
			}
		};

		try {
			iscmdtoken = false;
			if ((typeof cmd.authorizeSecret == "string") && (cmd.authorizeSecret.length > 0)) {
				authsecret = cmd.authorizeSecret;
				if ((typeof cmd.authorizePath == "string") && (cmd.authorizePath.length > 0)) {
					authpath = cmd.authorizePath;
				}
				else {
					authpath = SystemInterface.Constant.DefaultAuthorizePath;
				}
				if ((typeof cmd.authorizeToken == "string") && (cmd.authorizeToken.length > 0)) {
					authtoken = cmd.authorizeToken;
					iscmdtoken = true;
				}
				else {
					authtoken = "";
				}
			}
			else {
				authsecret = this.authorizeSecret;
				authpath = this.authorizePath;
				authtoken = this.authorizeToken;
			}
			if ((authsecret.length > 0) && (authtoken.length > 0)) {
				App.systemAgent.setCommandAuthorization (cmd.cmdInv, authsecret, authtoken);
			}

			const response = await this.doInvokeCommand (cmd.invokePath, cmd.cmdInv, cmd.responseCommandId);
			this.commandResolveEventEmitter.emit (`${cmd.id}`, response);
			endInvoke ();
			return;
		}
		catch (err) {
			if (!((err.message == UnauthorizedErrorMessage) && (authsecret.length > 0) && (! iscmdtoken))) {
				this.commandRejectEventEmitter.emit (`${cmd.id}`, err);
				endInvoke ();
				return;
			}
		}

		try {
			const authcmd = App.systemAgent.createCommand ("Authorize", SystemInterface.Constant.DefaultCommandType, {
				token: App.systemAgent.getRandomString (App.AuthorizeTokenLength)
			}, authsecret, null);
			const response = await this.doInvokeCommand ((authpath.length > 0) ? authpath : SystemInterface.Constant.DefaultAuthorizePath, authcmd, SystemInterface.CommandId.AuthorizeResult);
			authtoken = response.params.token;
			this.authorizeToken = response.params.token;
		}
		catch (err) {
			this.commandRejectEventEmitter.emit (`${cmd.id}`, Error (UnauthorizedErrorMessage));
			endInvoke ();
			return;
		}

		try {
			App.systemAgent.setCommandAuthorization (cmd.cmdInv, authsecret, authtoken);
			const response = await this.doInvokeCommand (cmd.invokePath, cmd.cmdInv, cmd.responseCommandId);
			this.commandResolveEventEmitter.emit (`${cmd.id}`, response);
			endInvoke ();
			return;
		}
		catch (err) {
			this.commandRejectEventEmitter.emit (`${cmd.id}`, err);
			endInvoke ();
			return;
		}
	}

	// Return a promise that invokes a command on the agent. If responseCommandId is provided, the response command must match that type. If the command invocation succeeds, resolve with the response command.
	doInvokeCommand (invokePath, cmdInv, responseCommandId) {
		if ((this.urlHostname.length <= 0) || (this.tcpPort1 <= 0)) {
			return (Promise.reject (Error (`Missing host address for agent ID ${this.agentId}`)));
		}

		return (new Promise ((resolve, reject) => {
			let path, body, req;

			path = invokePath;
			if (path.indexOf ("/") != 0) {
				path = `/${path}`;
			}
			path += `?${SystemInterface.Constant.UrlQueryParameter}=${encodeURIComponent (JSON.stringify (cmdInv))}`;
			const options = {
				method: "GET",
				hostname: this.urlHostname,
				port: this.tcpPort1,
				path: path,
				headers: {
					"User-Agent": App.systemAgent.userAgent
				}
			};

			body = "";
			const requestStarted = (res) => {
				if (res.statusCode == 401) {
					reject (Error (UnauthorizedErrorMessage));
					return;
				}

				if (res.statusCode != 200) {
					reject (Error (`Non-success response code ${res.statusCode}`));
					return;
				}
				res.on ("error", (err) => {
					reject (Error (err));
				});
				res.on ("data", (data) => {
					body += data.toString ();
				});
				res.on ("end", () => {
					const responsecmd = SystemInterface.parseCommand (body);
					if (SystemInterface.isError (responsecmd)) {
						reject (Error (`Invalid response data, ${responsecmd}`));
						return;
					}
					if ((typeof responseCommandId == "number") && (responsecmd.command != responseCommandId)) {
						reject (Error (`Incorrect response type ${responsecmd.command}, expected ${responseCommandId}`));
						return;
					}
					resolve (responsecmd);
				});
			};

			if (App.EnableHttps) {
				options.protocol = "https:";
				options.agent = new Https.Agent ({
					// TODO: Possibly set the "ca" option (certificate authority block) here instead of rejectUnauthorized, i.e. Fs.readFileSync ("tls-cert.pem")
					rejectUnauthorized: false
				});
				req = Https.request (options, requestStarted);
			}
			else {
				options.protocol = "http:";
				req = Http.request (options, requestStarted);
			}
			req.on ("error", (err) => {
				reject (Error (err));
			});
			req.end ();
		}));
	}
}
module.exports = Agent;
