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
// Class that holds state regarding a remote system agent

"use strict";

const App = global.App || { };
const Util = require ("util");
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const SystemInterface = require (App.SOURCE_DIRECTORY + "/SystemInterface");

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
		this.lastStatus = { };
		this.lastStatusTime = 0;
	}

	// Return a string representation of the agent
	toString () {
		return (`<Agent id=${this.agentId} displayName=${this.displayName} urlHostname=${this.urlHostname} version=${this.version} runCount=${this.runCount}/${this.maxRunCount}>`);
	}

	// Update status with fields from an AgentStatus command
	updateStatus (statusCommand) {
		this.lastStatus = statusCommand.params;
		this.lastStatusTime = new Date ().getTime ();

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
}

module.exports = Agent;
