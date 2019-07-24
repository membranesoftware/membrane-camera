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
// Base class for server objects

"use strict";

const App = global.App || { };
const Result = require (App.SOURCE_DIRECTORY + "/Result");
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const SystemInterface = require (App.SOURCE_DIRECTORY + "/SystemInterface");

class ServerBase {
	constructor () {
		// Set this value to specify the server's name, usually expected to match its class name
		this.name = "ServerBase";

		// Set this value to specify the server's description
		this.description = "";

		// Populate this list with SystemInterface Type field items to specify parameters acceptable for server configuration
		this.configureParams = [ ];

		// Set values in this map for use as default configuration parameters
		this.baseConfiguration = { };

		// Fields in this object are set by the configure method, using items from the configureParams list
		this.configureMap = { };

		// Fields in this object are set by the configure method, storing fields that differ from the base configuration
		this.deltaConfiguration = { };

		// Set values in this map that should be included in status report strings
		this.statusMap = { };

		// Set this value to indicate whether the server has been configured with valid parameters
		this.isConfigured = false;

		// Set this value to indicate whether the server is running
		this.isRunning = false;
	}

	// Return a string representation of the server
	toString () {
		let s;

		s = "<" + this.name;
		if (Object.keys (this.statusMap).length > 0) {
			s += " " + JSON.stringify (this.statusMap);
		}
		s += ">";

		return (s);
	}

	// Return the AgentConfiguration field name that holds configuration values for servers of this type
	getAgentConfigurationKey () {
		return (this.name.substring (0, 1).toLowerCase () + this.name.substring (1) + "Configuration");
	}

	// Return the AgentStatus field name that holds status values for servers of this type
	getAgentStatusKey () {
		return (this.name.substring (0, 1).toLowerCase () + this.name.substring (1) + "Status");
	}

	// Configure the server using values in the provided params object and set the isConfigured data member to reflect whether the configuration was successful
	configure (configParams) {
		let fields;

		if ((typeof configParams != "object") || (configParams == null)) {
			configParams = { };
		}

		fields = this.parseConfiguration (configParams);
		if (SystemInterface.isError (fields)) {
			Log.err (`${this.toString ()} configuration parse error; err=${fields}`);
			return;
		}

		this.configureMap = fields;
		this.deltaConfiguration = configParams;
		this.isConfigured = true;
		this.doConfigure ();
	}

	// Subclass method. Implementations should execute actions appropriate when the server has been successfully configured
	doConfigure () {
		// Default implementation does nothing
	}

	// Return an object containing configuration fields parsed from the server's base configuration combined with the provided parameters, or an error message if the parse failed
	parseConfiguration (configParams) {
		let c;

		c = { };
		for (let i in this.baseConfiguration) {
			c[i] = this.baseConfiguration[i];
		}
		if ((typeof configParams == "object") && (configParams != null)) {
			for (let i in configParams) {
				c[i] = configParams[i];
			}
		}

		return (SystemInterface.parseFields (this.configureParams, c));
	}

	// Return a boolean value indicating if the provided object contains valid configuration parameters
	isConfigurationValid (configParams) {
		return (! SystemInterface.isError (this.parseConfiguration (configParams)));
	}

	// Start the server's operation and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred). If the start operation succeeds, isRunning is set to true.
	start (startCallback) {
		if (! this.isConfigured) {
			process.nextTick (function () {
				startCallback ("Invalid configuration");
			});
			return;
		}

		this.doStart ((err) => {
			if (err == null) {
				this.isRunning = true;
			}
			startCallback (err);
		});
	}

	// Execute subclass-specific start operations and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred)
	doStart (startCallback) {
		// Default implementation does nothing
		process.nextTick (startCallback);
	}

	// Stop the server's operation and set isRunning to false, and invoke the provided callback when complete
	stop (stopCallback) {
		this.isRunning = false;
		this.doStop (stopCallback);
	}

	// Execute subclass-specific stop operations and invoke the provided callback when complete
	doStop (stopCallback) {
		// Default implementation does nothing
		process.nextTick (stopCallback);
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
		let cmd, fieldname;

		cmd = this.getStatus ();
		if (cmd == null) {
			return;
		}

		fields[this.getAgentStatusKey ()] = cmd.params;
	}

	// Provide server configuration data by adding an appropriate field to an AgentConfiguration params object
	getConfiguration (agentConfiguration) {
		let c;

		c = { };
		for (let i in this.baseConfiguration) {
			c[i] = this.baseConfiguration[i];
		}
		for (let i in this.deltaConfiguration) {
			c[i] = this.deltaConfiguration[i];
		}
		this.doGetConfiguration (c);
		agentConfiguration[this.getAgentConfigurationKey ()] = c;
	}

	// Add subclass-specific fields to the provided server configuration object, covering default values not present in the delta configuration
	doGetConfiguration (fields) {
		// Default implementation does nothing
	}

	// Return an object containing a command with the default agent prefix and the provided parameters, or null if the command could not be validated, in which case an error log message is generated
	createCommand (commandName, commandType, commandParams) {
		let cmd;

		cmd = SystemInterface.createCommand (App.systemAgent.getCommandPrefix (), commandName, commandType, commandParams);
		if (SystemInterface.isError (cmd)) {
			Log.err (`${this.toString ()} failed to create command invocation; commandName=${commandName} err=${cmd}`);
			return (null);
		}

		return (cmd);
	}
}

module.exports = ServerBase;
