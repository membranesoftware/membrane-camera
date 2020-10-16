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
// Class that tracks and commands remote system agents

"use strict";

const App = global.App || { };
const Path = require ("path");
const SysUtil = require (Path.join (App.SOURCE_DIRECTORY, "SysUtil"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const RepeatTask = require (Path.join (App.SOURCE_DIRECTORY, "RepeatTask"));
const Agent = require (Path.join (App.SOURCE_DIRECTORY, "Agent"));

const AgentIdleTimeout = 900 * 1000; // ms

class AgentControl {
	constructor () {
		// A map of agent ID values to Agent objects
		this.agentMap = { };

		this.expireTimeout = null;
		this.getAgentStatusTask = new RepeatTask ();
	}

	// Start the agent control's operation
	start () {
		this.expireAgents ();
		this.getAgentStatusTask.setRepeating ((callback) => {
			const cmd = App.systemAgent.getStatus ();
			if (cmd != null) {
				this.updateAgentStatus (cmd);
			}
			process.nextTick (callback);
		}, App.HeartbeatPeriod * 5, App.HeartbeatPeriod * 6);
	}

	// Stop the agent control's operation
	stop () {
		if (this.expireTimeout) {
			clearTimeout (this.expireTimeout);
			this.expireTimeout = null;
		}
		this.getAgentStatusTask.stop ();
	}

	// Store data received with an AgentStatus command
	updateAgentStatus (statusCommand) {
		const agent = SysUtil.getMapItem (this.agentMap, statusCommand.params.id, () => {
			return (new Agent ());
		});
		agent.updateStatus (statusCommand);
	}

	// Clear expireTimeout and set it to execute expireAgents after the specified millisecond delay
	setExpireTimeout (delay) {
		if (this.expireTimeout) {
			clearTimeout (this.expireTimeout);
			this.expireTimeout = null;
		}
		if (delay >= 0) {
			this.expireTimeout = setTimeout (() => {
				this.expireAgents ();
			}, delay);
		}
	}

	// Delete idle entries from agentMap and set a timeout to repeat the operation if appropriate
	expireAgents () {
		let t, delta, delay;

		delay = -1;
		const now = Date.now ();
		const keys = Object.keys (this.agentMap);
		for (const key of keys) {
			const agent = this.agentMap[key];
			if (agent.isInvoking || (agent.commandQueue.length > 0)) {
				continue;
			}

			t = agent.createTime;
			if (agent.lastStatusTime > t) {
				t = agent.lastStatusTime;
			}
			if (agent.lastInvokeTime > t) {
				t = agent.lastInvokeTime;
			}

			delta = now - t;
			if (delta >= AgentIdleTimeout) {
				delete this.agentMap[key];
			}
			else if (delta > 0) {
				delta = AgentIdleTimeout - delta;
				if ((delay < 0) || (delta < delay)) {
					delay = delta;
				}
			}
		}
		this.setExpireTimeout (delay);
	}

	// Set default authorization credentials for a contacted agent
	setAgentAuthorization (agentId, authorizePath, authorizeSecret, authorizeToken) {
		const agent = this.agentMap[agentId];
		if (agent == null) {
			return;
		}
		if (typeof authorizeToken != "string") {
			authorizeToken = "";
		}

		agent.authorizePath = authorizePath;
		agent.authorizeSecret = authorizeSecret;
		agent.authorizeToken = authorizeToken;
	}

	// Return an array containing contacted agents that cause the provided predicate function to generate a true value
	findAgents (matchFunction) {
		const m = [ ];
		for (const agent of Object.values (this.agentMap)) {
			if (matchFunction (agent)) {
				m.push (agent);
			}
		}

		return (m);
	}

	// Return the Agent object associated with the local system agent
	getLocalAgent () {
		return (SysUtil.getMapItem (this.agentMap, App.systemAgent.agentId, () => {
			return (new Agent ());
		}));
	}

	// Return a promise that invokes a command on an agent. If responseCommandId is provided, the response command must match that type. If authorization values are provided, apply them to cmdInv as needed. If the command invocation succeeds, resolve with the response command.
	invokeCommand (agentId, invokePath, cmdInv, responseCommandId, authorizePath, authorizeSecret, authorizeToken) {
		if (SystemInterface.isError (cmdInv)) {
			return (Promise.reject (Error (`Invalid command: ${cmdInv}`)));
		}
		if (agentId == App.systemAgent.agentId) {
			return (App.systemAgent.invokeCommand (invokePath, cmdInv, responseCommandId));
		}

		const agent = this.agentMap[agentId];
		if (agent == null) {
			return (Promise.reject (Error (`Unknown agent ID ${agentId}`)));
		}

		return (new Promise ((resolve, reject) => {
			this.setExpireTimeout (0);
			agent.invokeCommand (invokePath, cmdInv, responseCommandId, authorizePath, authorizeSecret, authorizeToken).then ((responseCommand) => {
				resolve (responseCommand);
			}).catch ((err) => {
				reject (err);
			}).then (() => {
				this.setExpireTimeout (0);
			});
		}));
	}

	// Return a promise that invokes a command on the host specified in a SystemInterface AgentHost object. If responseCommandId is provided, the response command must match that type. If the command invocation succeeds, resolve with the response command.
	invokeHostCommand (targetHost, invokePath, cmdInv, responseCommandId) {
		let hostname, port, targetagent;

		hostname = targetHost.hostname;
		port = SystemInterface.Constant.DefaultTcpPort1;
		const matches = hostname.match (/^([a-zA-Z0-9-.]+):([0-9]+)$/);
		if (Array.isArray (matches)) {
			hostname = matches[1];
			port = +(matches[2]);
			if (isNaN (port)) {
				port = SystemInterface.Constant.DefaultTcpPort1;
			}
		}

		const agents = this.findAgents ((agent) => {
			return ((agent.urlHostname == hostname) && (agent.tcpPort1 == port));
		});
		if (agents.length > 0) {
			targetagent = agents[0];
		}
		else {
			const key = `${hostname}:${port}`;
			targetagent = SysUtil.getMapItem (this.agentMap, key, () => {
				const agent = new Agent ();
				agent.urlHostname = hostname;
				agent.tcpPort1 = port;

				return (agent);
			});
		}

		return (new Promise ((resolve, reject) => {
			this.setExpireTimeout (0);
			targetagent.invokeCommand (invokePath, cmdInv, responseCommandId, (typeof targetHost.authorizePath == "string") ? targetHost.authorizePath : "", (typeof targetHost.authorizeSecret == "string") ? targetHost.authorizeSecret : "", (typeof targetHost.authorizeToken == "string") ? targetHost.authorizeToken : "").then ((responseCommand) => {
				resolve (responseCommand);
			}).catch ((err) => {
				reject (err);
			}).then (() => {
				this.setExpireTimeout (0);
			});
		}));
	}
}
module.exports = AgentControl;
