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
// Base class for intents

"use strict";

const App = global.App || { };
const Path = require ("path");
const UuidV4 = require ("uuid/v4");
const Result = require (Path.join (App.SOURCE_DIRECTORY, "Result"));
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const Prng = require (Path.join (App.SOURCE_DIRECTORY, "Prng"));

class IntentBase {
	constructor () {
		// Read-write data members
		this.id = "00000000-0000-0000-0000-000000000000";
		this.name = "Intent";
		this.groupName = "";
		this.displayName = "Job";
		this.isActive = true;
		this.configureCommandId = -1;
		this.conditions = [ ];
		this.state = { };
		this.stateType = "";
		this.updateTime = 0;
		this.statusMap = { };
		this.conditionMap = { };

		this.prng = new Prng ();
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
		return (Result.Success);
	}

	// Configure the intent's state using the provided command and return a Result value.
	configureFromCommand (cmdInv) {
		if (this.configureCommandId < 0) {
			return (Result.UnknownTypeError);
		}
		if (cmdInv.command != this.configureCommandId) {
			return (Result.InvalidParamsError);
		}

		return (this.configure (cmdInv.params));
	}

	// Return a string description of the intent
	toString () {
		let s;

		s = `<Intent id=${this.id} name=${this.name} displayName="${this.displayName}"`;
		if (this.groupName != "") {
			s += ` groupName=${this.groupName}`;
		}
		s += ` isActive=${this.isActive}`;
		const keys = Object.keys (this.statusMap);
		if (keys.length > 0) {
			keys.sort ();
			for (let i = 0; i < keys.length; ++i) {
				s += ` ${keys[i]}="${this.statusMap[keys[i]]}"`;
			}
		}
		s += ">";

		return (s);
	}

	// Return an object containing fields from the intent, suitable for use as parameters in an IntentState command
	getIntentState () {
		const result = {
			id: this.id,
			name: this.name,
			groupName: this.groupName,
			displayName: this.displayName,
			isActive: this.isActive
		};

		if (this.conditions.length > 0) {
			result.conditions = this.conditions;
		}

		if (this.stateType == "") {
			result.state = this.state;
		}
		else {
			result.state = SystemInterface.parseTypeObject (this.stateType, this.state);
			if (SystemInterface.isError (result.state)) {
				Log.warn (`Failed to store intent state; name=${this.name} stateType=${this.stateType} err=${result.state}`);
				result.state = { };
			}
		}

		return (result);
	}

	// Reset fields in the intent using values from the provided IntentState params object
	readIntentState (intentState) {
		let state;

		this.id = intentState.id;
		this.name = intentState.name;
		this.groupName = intentState.groupName;
		this.displayName = intentState.displayName;
		this.isActive = intentState.isActive;

		this.conditions = [ ];
		if (Array.isArray (intentState.conditions)) {
			this.conditions = intentState.conditions;
		}

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

	// Return a map of condition names to priority values, as computed from current state matched against configured conditions
	matchConditions () {
		// Superclass method takes no action
		return (this.doMatchConditions ());
	}

	// Return a subclass-specific map of condition names to priority values, as computed from current state matched against configured conditions
	doMatchConditions () {
		// Default implementation returns no matches
		return ({ });
	}

	// Return a boolean value indicating if conditionMap indicates possession of the named condition
	getCondition (conditionName) {
		return (this.conditionMap[conditionName] === this.id);
	}

	// Perform actions appropriate for the current state of the application
	update () {
		if (! this.isActive) {
			return;
		}

		this.doUpdate ();
	}

	// Perform subclass-specific actions appropriate for the current state of the application
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

	// Return an object containing a command with the default agent prefix and the provided parameters, or null if the command could not be validated, in which case an error log message is generated
	createCommand (commandName, commandType, commandParams) {
		const cmd = SystemInterface.createCommand (App.systemAgent.getCommandPrefix (), commandName, commandType, commandParams);
		if (SystemInterface.isError (cmd)) {
			return (null);
		}

		return (cmd);
	}

	// Return a boolean value indicating if the specified time period has elapsed, relative to the intent's update time. startTime and period are both measured in milliseconds.
	hasTimeElapsed (startTime, period) {
		const diff = this.updateTime - startTime;
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

		for (const i of obj) {
			if (typeof i != "string") {
				return (false);
			}
		}

		return (true);
	}

	// Suspend all items in the provided map of RepeatTasks items
	suspendTasks (taskMap) {
		for (const i in taskMap) {
			const task = taskMap[i];
			task.suspendRepeat ();
		}
	}

	// Resume all items in the provided map of RepeatTasks items
	resumeTasks (taskMap) {
		for (const i in taskMap) {
			const task = taskMap[i];
			task.setNextRepeat (0);
		}
	}

	// Return a newly created array with the same contents as the provided source array
	copyArray (sourceArray) {
		const a = [ ];
		for (let i = 0; i < sourceArray.length; ++i) {
			a.push (sourceArray[i]);
		}
		return (a);
	}

	// Choose the next sequential item from itemArray. To track the chosen item, update choiceArray (expected to be an empty array for the first call). Returns the chosen item, or null if no items were available.
	getSequentialChoice (itemArray, choiceArray) {
		if ((! Array.isArray (itemArray)) || (itemArray.length <= 0)) {
			return (null);
		}
		if (! Array.isArray (choiceArray)) {
			return (itemArray[0]);
		}

		if (choiceArray.length <= 0) {
			this.populateChoiceArray (choiceArray, itemArray.length);
		}
		const result = itemArray[choiceArray.shift ()];
		if (choiceArray.length <= 0) {
			this.populateChoiceArray (choiceArray, itemArray.length);
		}

		return (result);
	}

	// Choose an item at random from itemArray. To track the chosen item, update choiceArray (expected to be an empty array for the first call). Returns the chosen item, or null if no items were available.
	getRandomChoice (itemArray, choiceArray) {
		if ((! Array.isArray (itemArray)) || (itemArray.length <= 0)) {
			return (null);
		}
		if (! Array.isArray (choiceArray)) {
			return (itemArray[this.prng.getRandomInteger (0, itemArray.length - 1)]);
		}

		if (choiceArray.length <= 0) {
			this.populateChoiceArray (choiceArray, itemArray.length, true);
		}
		const index = choiceArray.shift ();
		const result = itemArray[index];
		if (choiceArray.length <= 0) {
			this.populateChoiceArray (choiceArray, itemArray.length, true, index);
		}

		return (result);
	}

	// Add index items to choiceArray as needed to track a new choice run, optionally shuffling the choices as they are added. If isShuffle is true and firstExcludeChoice is provided, ensure that the first populated choice item does not match that value.
	populateChoiceArray (choiceArray, choiceCount, isShuffle, firstExcludeChoice) {
		let pos;

		if (isShuffle !== true) {
			for (let i = 0; i < choiceCount; ++i) {
				choiceArray.push (i);
			}
			return;
		}

		const choices = [ ];
		for (let i = 0; i < choiceCount; ++i) {
			choices.push (i);
		}
		for (let i = 0; i < choiceCount; ++i) {
			while (true) {
				pos = this.prng.getRandomInteger (0, choices.length - 1);
				if (typeof firstExcludeChoice == "number") {
					if ((i == 0) && (choiceCount > 1) && (choices[pos] == firstExcludeChoice)) {
						continue;
					}
				}
				break;
			}
			choiceArray.push (choices[pos]);
			choices.splice (pos, 1);
		}
	}
}
module.exports = IntentBase;
