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
// Base class for intents

"use strict";

const App = global.App || { };
const Path = require ("path");
const Uuid = require ("uuid");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));

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
		this.stage = "";
		this.stagePromise = null;
		this.stagePromiseResult = null;
		this.stagePromiseError = null;
	}

	// Configure the intent's state using values in the provided params object
	configure (configParams) {
		if (typeof configParams.displayName == "string") {
			this.displayName = configParams.displayName;
		}
		this.doConfigure (configParams);
	}

	// Configure the intent's subclass-specific state using values in the provided params object
	doConfigure (configParams) {
		// Default implementation does nothing
	}

	// Configure the intent's state using the provided command
	configureFromCommand (cmdInv) {
		if (this.configureCommandId < 0) {
			throw Error ("Configure by command not available");
		}
		if (cmdInv.command != this.configureCommandId) {
			throw Error ("Incorrect command type");
		}
		this.configure (cmdInv.params);
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
			this.id = Uuid.v4 ();
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

	// Execute actions appropriate for the current state of the application
	update () {
		if (! this.isActive) {
			return;
		}
		this.doUpdate ();
		if ((this.stage != "") && (this.stagePromise == null)) {
			this[this.stage] ();
		}
	}

	// Execute subclass-specific actions appropriate for the current state of the application
	doUpdate () {
		// Default implementation does nothing
	}

	// Execute actions appropriate when the intent becomes active
	start () {
		this.stage = "";
		this.doStart ();
	}

	// Execute subclass-specific actions appropriate when the intent becomes active. Subclasses are expected to implement this method if needed.
	doStart () {
		// Default implementation does nothing
	}

	// Execute actions appropriate when the intent becomes inactive
	stop () {
		this.clearStage ();
		this.doStop ();
	}

	// Execute subclass-specific actions appropriate when the intent becomes inactive. Subclasses are expected to implement this method if needed.
	doStop () {
		// Default implementation does nothing
	}

	setStage (stage) {
		if (stage === this.stage) {
			return;
		}
		if (typeof this[stage] !== "function") {
			Log.err (`${this.toString ()} setStage failed, unknown stage name; stage=${stage}`);
			return;
		}
		this.statusMap.stage = stage;
		this.stage = stage;
		this.stagePromise = null;
		this[this.stage] ();
	}

	clearStage () {
		this.stage = "";
		this.stagePromise = null;
		this.stagePromiseResult = null;
		this.stagePromiseError = null;
		delete this.statusMap.stage;
	}

	// Suspend stage processing until promise completes, then set the stage to nextStage
	stageAwait (promise, nextStage) {
		this.stagePromise = promise;
		this.stagePromiseResult = null;
		this.stagePromiseError = null;
		promise.then ((result) => {
			if (this.stagePromise == promise) {
				this.stagePromiseResult = result;
				this.setStage (nextStage);
			}
		}).catch ((err) => {
			if (this.stagePromise == promise) {
				this.stagePromiseError = err;
				this.setStage (nextStage);
			}
		});
	}

	// Return a promise that resolves after a millisecond duration elapses
	timeoutWait (duration) {
		return (new Promise ((resolve, reject) => {
			setTimeout (resolve, duration);
		}));
	}

	// Return a boolean value indicating if the specified time period has elapsed, relative to the intent's update time. startTime and period are both measured in milliseconds.
	hasTimeElapsed (startTime, period) {
		const diff = this.updateTime - startTime;
		return (diff >= period);
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
			return (itemArray[App.systemAgent.getRandomInteger (0, itemArray.length - 1)]);
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
				pos = App.systemAgent.getRandomInteger (0, choices.length - 1);
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
