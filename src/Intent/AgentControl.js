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
// Class that tracks the state of remote system agents

"use strict";

const App = global.App || { };
const Result = require (App.SOURCE_DIRECTORY + "/Result");
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const MapUtil = require (App.SOURCE_DIRECTORY + "/MapUtil");
const SystemInterface = require (App.SOURCE_DIRECTORY + "/SystemInterface");
const Agent = require (App.SOURCE_DIRECTORY + "/Intent/Agent");

class AgentControl {
	constructor () {
		// A map of URL hostname values to Agent objects
		this.agentMap = { };
	}

	// Return a string representation of the object
	toString () {
		return (`<AgentControl count=${Object.keys (this.agentMap).length}>`);
	}

	// Store data received with an AgentStatus command
	updateAgentStatus (statusCommand) {
		let agent;

		agent = MapUtil.getItem (this.agentMap, statusCommand.params.id, () => {
			return (new Agent ());
		});
		agent.updateStatus (statusCommand);
	}

	// Return an array containing contacted agents that cause the provided predicate function to generate a true value
	findAgents (matchFunction) {
		let m;

		m = [ ];
		for (let agent of Object.values (this.agentMap)) {
			if (matchFunction (agent)) {
				m.push (agent);
			}
		}

		return (m);
	}
}

module.exports = AgentControl;
