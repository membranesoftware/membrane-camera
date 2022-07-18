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
// Class that runs a task function, as executed by TaskGroup

"use strict";

class Task {
	constructor (configureMap) {
		// Read-only data members
		this.name = "Task";
		this.subtitle = "";
		this.configureMap = configureMap;
		if ((typeof this.configureMap != "object") || (this.configureMap == null)) {
			this.configureMap = { };
		}
		this.createTime = Date.now ();
		this.isRunning = false;
		this.isSuccess = false;
		this.isCancelled = false;
		this.isEnded = false;
		this.resultObjectType = "";
		this.resultObject = { };
		this.startTime = 0;
		this.endTime = 0;
		this.runError = "";

		this.id = "00000000-0000-0000-0000-000000000000";
		this.statusMap = {
			percentComplete: 0
		};
	}

	// Return a string representation of the task
	toString () {
		let s;

		s = `<Task id=${this.id} name="${this.name}"`;
		if (Object.keys (this.statusMap).length > 0) {
			s += ` ${JSON.stringify (this.statusMap)}`;
		}
		if (this.isRunning) {
			s += " isRunning";
		}
		if (this.isCancelled) {
			s += " isCancelled";
		}
		if (this.isSuccess) {
			s += " isSuccess";
		}
		s += ">";

		return (s);
	}

	// Execute the task's operations
	async run () {
		// Default implementation does nothing
	}

	// Execute operations to end a task run
	async end () {
		// Default implementation does nothing
	}

	// Execute operations to cancel the task while running
	async cancel () {
		// Default implementation does nothing
	}

	// Return a SystemInterface TaskItem object with fields populated from the task
	getTaskItem () {
		return ({
			id: this.id,
			name: this.name,
			subtitle: this.subtitle,
			isRunning: this.isRunning,
			percentComplete: this.getPercentComplete (),
			createTime: this.createTime,
			endTime: this.endTime
		});
	}

	// Return the percent complete value for the task
	getPercentComplete () {
		return (typeof this.statusMap.percentComplete == "number" ? Math.floor (this.statusMap.percentComplete) : 0);
	}

	// Set the percent complete value for the task
	setPercentComplete (value) {
		if (value < 0) {
			value = 0;
		}
		if (value > 100) {
			value = 100;
		}
		this.statusMap.percentComplete = value;
	}

	// Add the specified delta to the percent complete value for the task
	addPercentComplete (value) {
		this.setPercentComplete (this.statusMap.percentComplete + value);
	}

	// Throw an error if the task has been cancelled
	cancelBreak () {
		if (this.isCancelled) {
			throw Error ("Task cancelled");
		}
	}
}
module.exports = Task;
