/*
* Copyright 2019-2022 Membrane Software <author@membranesoftware.com> https://membranesoftware.com
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
// Base class for server objects

"use strict";

const App = global.App || { };
const Path = require ("path");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const StringUtil = require (Path.join (App.SOURCE_DIRECTORY, "StringUtil"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));

class ServerBase {
	constructor () {
		this.name = "ServerBase";
		this.agentConfigurationKey = "";
		this.agentStatusKey = "";
		this.description = "";
		this.configureParams = [ ];
		this.baseConfiguration = { };
		this.configureMap = { };
		this.deltaConfiguration = { };
		this.statusMap = { };
		this.isConfigured = false;
		this.isRunning = false;
	}

	// Return a string representation of the server
	toString () {
		let s;

		s = `<${this.name}`;
		if (Object.keys (this.statusMap).length > 0) {
			s += ` ${JSON.stringify (this.statusMap)}`;
		}
		s += ">";

		return (s);
	}

	// Set the server's name and related fields
	setName (name) {
		this.name = name;
		this.agentConfigurationKey = `${this.name.substring (0, 1).toLowerCase ()}${this.name.substring (1)}Configuration`;
		this.agentStatusKey = `${this.name.substring (0, 1).toLowerCase ()}${this.name.substring (1)}Status`;
	}

	// Configure the server using values in the provided params object and set the isConfigured data member to reflect whether the configuration was successful
	configure (configParams) {
		if ((typeof configParams != "object") || (configParams == null)) {
			configParams = { };
		}

		const fields = this.parseConfiguration (configParams);
		if (SystemInterface.isError (fields)) {
			Log.err (`${this.name} configuration parse error; err=${fields}`);
			return;
		}

		this.configureMap = fields;
		this.deltaConfiguration = configParams;
		this.isConfigured = true;
		this.doConfigure ();
	}

	// Execute subclass-specific actions appropriate when the server has been successfully configured
	doConfigure () {
		// Default implementation does nothing
	}

	// Return an object containing configuration fields parsed from the server's base configuration combined with the provided parameters, or an error message if the parse failed
	parseConfiguration (configParams) {
		const c = { };
		for (const i in this.baseConfiguration) {
			c[i] = this.baseConfiguration[i];
		}
		if ((typeof configParams == "object") && (configParams != null)) {
			for (const i in configParams) {
				c[i] = configParams[i];
			}
		}
		return (SystemInterface.parseFields (this.configureParams, c));
	}

	// Return a boolean value indicating if the provided object contains valid configuration parameters
	isConfigurationValid (configParams) {
		return (! SystemInterface.isError (this.parseConfiguration (configParams)));
	}

	// Start the server's operation and invoke startCallback (err) when complete. If the start operation succeeds, isRunning is set to true.
	start (startCallback) {
		let starterror;

		if (! this.isConfigured) {
			process.nextTick (() => {
				startCallback ("Invalid configuration");
			});
			return;
		}

		starterror = undefined;
		this.doStart ().catch ((err) => {
			starterror = err;
		}).then (() => {
			if (starterror === undefined) {
				this.isRunning = true;
			}
			startCallback (starterror);
		});
	}

	// Execute subclass-specific start operations
	async doStart () {
		// Default implementation does nothing
	}

	// Stop the server's operation, set isRunning to false, and invoke stopCallback when complete
	stop (stopCallback) {
		this.isRunning = false;
		this.doStop ().catch ((err) => {
			Log.debug (`${this.name} doStop failed; err=${err}`);
		}).then (() => {
			stopCallback ();
		});
	}

	// Execute subclass-specific stop operations
	async doStop () {
		// Default implementation does nothing
	}

	// Return a command invocation containing the server's status, or null if the server is not active
	getStatus () {
		if (! this.isRunning) {
			return (null);
		}
		return (this.doGetStatus ());
	}

	// Return a command invocation containing the server's status
	doGetStatus () {
		// Default implementation returns null
		return (null);
	}

	// Set a server status field in the provided AgentStatus params object
	setStatus (fields) {
		const cmd = this.getStatus ();
		if (cmd == null) {
			return;
		}
		fields[this.agentStatusKey] = cmd.params;
	}

	// Return a boolean value indicating if the provided AgentStatus command contains a server status change
	findStatusChange (agentStatus) {
		if (! this.isRunning) {
			return (false);
		}
		return (this.doFindStatusChange (agentStatus));
	}

	// Return a boolean value indicating if the provided AgentStatus command contains a subclass-specific server status change
	doFindStatusChange (agentStatus) {
		// Default implementation returns false
		return (false);
	}

	// Provide server configuration data by adding an appropriate field to an AgentConfiguration params object
	getConfiguration (agentConfiguration) {
		const c = { };
		for (const i in this.baseConfiguration) {
			c[i] = this.baseConfiguration[i];
		}
		for (const i in this.deltaConfiguration) {
			c[i] = this.deltaConfiguration[i];
		}
		this.doGetConfiguration (c);
		agentConfiguration[this.agentConfigurationKey] = c;
	}

	// Add subclass-specific fields to the provided server configuration object, covering default values not present in the delta configuration
	doGetConfiguration (fields) {
		// Default implementation does nothing
	}

	// Set an invocation handler for the specified path and command ID, using the server's async method with the matching command name as the handler function
	addInvokeRequestHandler (invokePath, commandId) {
		const cmdname = SystemInterface.getCommandName (commandId);
		if (cmdname == "") {
			throw Error (`Unknown command ID ${commandId}`);
		}
		const methodname = StringUtil.uncapitalized (cmdname);
		if (typeof this[methodname] != "function") {
			throw Error (`Missing ${this.name} command handler for ${cmdname}`);
		}
		App.systemAgent.addInvokeRequestHandler (invokePath, commandId, (cmdInv, request, response) => {
			const token = cmdInv.prefix[SystemInterface.Constant.AuthorizationTokenPrefixField];
			if (token !== undefined) {
				App.systemAgent.accessControl.setSessionSustained (token, true);
			}

			this[methodname] (cmdInv, request, response).catch ((err) => {
				Log.err (`${this.name} ${cmdname} command failed; err=${err}`);
				App.systemAgent.writeResponse (request, response, 500);
			}).then (() => {
				if (token !== undefined) {
					App.systemAgent.accessControl.setSessionSustained (token, false);
				}
			});
		});
	}

	// Set a secondary invocation handler for the specified path and command ID, using the server's async method with the matching command name as the handler function
	addSecondaryInvokeRequestHandler (invokePath, commandId) {
		const cmdname = SystemInterface.getCommandName (commandId);
		if (cmdname == "") {
			throw Error (`Unknown command ID ${commandId}`);
		}
		const methodname = StringUtil.uncapitalized (cmdname);
		if (typeof this[methodname] != "function") {
			throw Error (`Missing ${this.name} command handler for ${cmdname}`);
		}
		App.systemAgent.addSecondaryInvokeRequestHandler (invokePath, commandId, (cmdInv, request, response) => {
			const token = cmdInv.prefix[SystemInterface.Constant.AuthorizationTokenPrefixField];
			if (token !== undefined) {
				App.systemAgent.accessControl.setSessionSustained (token, true);
			}

			this[methodname] (cmdInv, request, response).catch ((err) => {
				Log.err (`${this.name} ${cmdname} command failed; err=${err}`);
				App.systemAgent.writeResponse (request, response, 500);
			}).then (() => {
				if (token !== undefined) {
					App.systemAgent.accessControl.setSessionSustained (token, false);
				}
			});
		});
	}

	// Set a link command handler for the specified command ID, using the server's async method with the matching command name as the handler function
	addLinkCommandHandler (commandId) {
		const cmdname = SystemInterface.getCommandName (commandId);
		if (cmdname == "") {
			throw Error (`Unknown command ID ${commandId}`);
		}
		const methodname = StringUtil.uncapitalized (cmdname);
		if (typeof this[methodname] != "function") {
			throw Error (`Missing ${this.name} command handler for ${cmdname}`);
		}
		App.systemAgent.addLinkCommandHandler (commandId, (cmdInv, client) => {
			this[methodname] (cmdInv, client).catch ((err) => {
				Log.err (`${this.name} ${cmdname} command failed; err=${err}`);
			});
		});
	}
}
module.exports = ServerBase;
