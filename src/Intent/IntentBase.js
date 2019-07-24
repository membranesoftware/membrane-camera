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
// Base class for intents

"use strict";

const App = global.App || { };
const UuidV4 = require ("uuid/v4");
const Result = require (App.SOURCE_DIRECTORY + "/Result");
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const SystemInterface = require (App.SOURCE_DIRECTORY + "/SystemInterface");
const AgentControl = require (App.SOURCE_DIRECTORY + "/Intent/AgentControl");

const UPDATE_LOG_PERIOD = 120000; // milliseconds

class IntentBase {
	constructor () {
		// Set this AgentControl object to provide the intent with agent visibility
		this.agentControl = null;

		// Set this value to specify the intent's ID (a UUID string)
		this.id = "00000000-0000-0000-0000-000000000000";

		// Set this value to specify the intent's name
		this.name = "Intent";

		// Set this value to specify the intent's group name
		this.groupName = "";

		// Set this value to specify the intent's display name
		this.displayName = "Job";

		// Set this value to specify whether the intent should be active. If inactive, the intent does not execute its update loop.
		this.isActive = true;

		// Set this value to specify the intent's description
		this.description = "";

		// An object used for holding persistent state associated with the intent, to be written as a record in the data store. Note that a MongoDB data store limits records to 16MB in size; intents should take care to keep state data below that maximum.
		this.state = { };

		// Set this value to a SystemInterface type that should be applied for parsing the state object
		this.stateType = "";

		// This value holds the current time during update calls
		this.updateTime = 0;

		// Set values in this map for inclusion in status report strings
		this.statusMap = { };
	}

	// Configure the intent's state using values in the provided params object. Returns a Result value.
	configure (configParams) {
		if (typeof configParams.displayName == "string") {
			this.displayName = configParams.displayName;
		}
		return (this.doConfigure (configParams));
	}

	// Configure the intent's state using values in the provided params object and return a Result value. Subclasses are expected to implement this method.
	doConfigure (configParams) {
		// Default implementation does nothing
		return (Result.SUCCESS);
	}

	// Return a string description of the intent
	toString () {
		let s, keys, i;

		s = "<Intent id=" + this.id + " name=" + this.name;
		if (this.groupName != "") {
			s += " groupName=" + this.groupName;
		}
		s += " isActive=" + this.isActive;
		keys = Object.keys (this.statusMap);
		if (keys.length > 0) {
			keys.sort ();
			for (i = 0; i < keys.length; ++i) {
				s += " " + keys[i] + "=\"" + this.statusMap[keys[i]] + "\"";
			}
		}
		s += ">";

		return (s);
	}

	// Return an object containing fields from the intent, suitable for use as parameters in an IntentState command
	getIntentState () {
		let state;

		if (this.stateType == "") {
			state = this.state;
		}
		else {
			state = SystemInterface.parseTypeObject (this.stateType, this.state);
			if (SystemInterface.isError (state)) {
				Log.warn (`Failed to store intent state; name=${this.name} stateType=${this.stateType} err=${state}`);
				state = { };
			}
		}

		return ({
			id: this.id,
			name: this.name,
			groupName: this.groupName,
			displayName: this.displayName,
			isActive: this.isActive,
			state: state
		});
	}

	// Reset fields in the intent using values from the provided IntentState params object
	readIntentState (intentState) {
		let state;

		this.id = intentState.id;
		this.name = intentState.name;
		this.groupName = intentState.groupName;
		this.displayName = intentState.displayName;
		this.isActive = intentState.isActive;

		if (this.stateType == "") {
			this.state = intentState.state;
		}
		else {
			state = SystemInterface.parseTypeObject (this.stateType, intentState.state);
			if (SystemInterface.isError (state)) {
				Log.warn (`Failed to load intent state; name=${this.name} stateType=${this.stateType} err=${state}`);
				state = { };
			}

			this.state = state;
		}
	}

	// If the intent holds an empty ID value, assign a new one
	assignId () {
		if (this.id == "00000000-0000-0000-0000-000000000000") {
			this.id = UuidV4 ();
		}
	}

	// Perform actions appropriate for the current state of the application
	update () {
		let now;

		if (! this.isActive) {
			return;
		}

		now = new Date ().getTime ();
		this.updateTime = now;
		this.doUpdate ();
	}

	// Perform actions appropriate for the current state of the application. Subclasses are expected to implement this method.
	doUpdate () {
		// Default implementation does nothing
	}

	// Perform actions appropriate when the intent becomes active
	start () {
		// Superclass method takes no action
		this.doStart ();
	}

	// Perform subclass-specific actions appropriate when the intent becomes active. Subclasses are expected to implement this method if needed.
	doStart () {
		// Default implementation does nothing
	}

	// Perform actions appropriate when the intent becomes inactive
	stop () {
		// Superclass method takes no action
		this.doStop ();
	}

	// Perform subclass-specific actions appropriate when the intent becomes inactive. Subclasses are expected to implement this method if needed.
	doStop () {
		// Default implementation does nothing
	}

	// Return a boolean value indicating if the task's last update time indicates that the specified time period has elapsed. startTime and period are both measured in milliseconds.
	hasTimeElapsed (startTime, period) {
		let diff;

		diff = this.updateTime - startTime;
		return (diff >= period);
	}

	// Return a boolean value indicating if the provided item is an object and is not null
	isObject (obj) {
		return ((typeof obj == "object") && (obj != null));
	}

	// Return a boolean value indicating if the provided item is an array with no contents other than strings
	isStringArray (obj) {
		if (! Array.isArray (obj)) {
			return (false);
		}

		for (let i of obj) {
			if (typeof i != "string") {
				return (false);
			}
		}

		return (true);
	}

	// Suspend all items in the provided map of RepeatTasks items
	suspendTasks (taskMap) {
		let i, task;

		for (i in taskMap) {
			task = taskMap[i];
			task.suspendRepeat ();
		}
	}

	// Resume all items in the provided map of RepeatTasks items
	resumeTasks (taskMap) {
		let i, task;

		for (i in taskMap) {
			task = taskMap[i];
			task.setNextRepeat (0);
		}
	}

	// Return a newly created array with the same contents as the provided source array
	copyArray (sourceArray) {
		let a, i;

		a = [ ];
		for (i = 0; i < sourceArray.length; ++i) {
			a.push (sourceArray[i]);
		}
		return (a);
	}

	// Return a newly created array containing indexes for use in tracking choices from a source array
	createChoiceArray (sourceArray) {
		let a;

		a = [ ];
		for (let i = 0; i < sourceArray.length; ++i) {
			a.push (i);
		}

		return (a);
	}

	// Choose an index at random from the provided choice array, while updating the array to track the chosen item. Returns the chosen index, or -1 if no choices were available
	getRandomChoice (choiceArray) {
		let pos, result;

		if (choiceArray.length <= 0) {
			return (-1);
		}

		pos = App.systemAgent.getRandomInteger (0, choiceArray.length - 1);
		result = choiceArray[pos];
		choiceArray.splice (pos, 1);

		return (result);
	}

	// Return an array containing contacted agents that cause the provided predicate function to generate a true value
	findAgents (matchFunction) {
		if (this.agentControl == null) {
			return ([ ]);
		}
		return (this.agentControl.findAgents (matchFunction));
	}
}

module.exports = IntentBase;
