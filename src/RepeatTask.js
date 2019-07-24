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
// Class that manages periodic and on-demand execution of a function

"use strict";

const App = global.App || { };
const Log = require (App.SOURCE_DIRECTORY + '/Log');

class RepeatTask {
	constructor () {
		this.taskFunction = (callback) => {
			process.nextTick (callback);
		};
		this.isExecuting = false;
		this.executeTimeout = null;
		this.isRepeating = false;
		this.isSuspended = false;
		this.nextRepeatPeriod = 0;
		this.minIntervalPeriod = 1000;
		this.maxIntervalPeriod = 2000;
	}

	// Set the task for repeated execution at an interval period, specified in milliseconds. Task execution is performed using taskFunction, which must expect a single "callback" parameter for invocation when the task completes. maxIntervalPeriod can be omitted if a randomized repeat interval is not needed.
	setRepeating (taskFunction, minIntervalPeriod, maxIntervalPeriod) {
		let shouldexecute;

		shouldexecute = false;
		if ((! this.isRepeating) || (taskFunction != this.taskFunction)) {
			shouldexecute = true;
		}
		this.isRepeating = true;
		this.isSuspended = false;
		this.taskFunction = taskFunction;
		this.minIntervalPeriod = minIntervalPeriod;
		if (typeof maxIntervalPeriod == 'number') {
			this.maxIntervalPeriod = maxIntervalPeriod;
		}
		else {
			this.maxIntervalPeriod = minIntervalPeriod;
		}

		if (shouldexecute) {
			this.setNextRepeat (0);
		}
	}

	// Execute the task
	execute () {
		let taskFunctionComplete;

		if (this.isExecuting) {
			return;
		}

		if (this.executeTimeout != null) {
			clearTimeout (this.executeTimeout);
			this.executeTimeout = null;
		}

		this.isExecuting = true;
		this.nextRepeatPeriod = 0;

		taskFunctionComplete = () => {
			let delay;

			this.isExecuting = false;
			if (this.isRepeating && (! this.isSuspended)) {
				if (this.nextRepeatPeriod > 0) {
					delay = this.nextRepeatPeriod;
					this.nextRepeatPeriod = 0;
				}
				else {
					delay = this.minIntervalPeriod;
					if (this.maxIntervalPeriod > this.minIntervalPeriod) {
						delay += Math.round (Math.random () * (this.maxIntervalPeriod - this.minIntervalPeriod));
					}
				}

				this.executeTimeout = setTimeout (() => {
					this.execute ();
				}, delay);
			}
		};

		this.taskFunction (taskFunctionComplete, this);
	}

	// Cancel any repeating execution that might be configured and clear the task function
	stop () {
		this.isRepeating = false;
		this.taskFunction = (callback) => {
			process.nextTick (callback);
		};
		if (this.executeTimeout != null) {
			clearTimeout (this.executeTimeout);
			this.executeTimeout = null;
		}
	}

	// Halt any future repeat executions until setNextRepeat is invoked
	suspendRepeat () {
		this.isSuspended = true;
		if (this.executeTimeout != null) {
			clearTimeout (this.executeTimeout);
			this.executeTimeout = null;
		}
	}

	// Set the task's next repeat execution to occur after the specified millisecond period elapses
	setNextRepeat (msElapsed) {
		if (! this.isRepeating) {
			return;
		}

		this.isSuspended = false;
		if (this.isExecuting) {
			this.nextRepeatPeriod = msElapsed;
			return;
		}

		if (this.executeTimeout != null) {
			clearTimeout (this.executeTimeout);
		}
		this.executeTimeout = setTimeout (() => {
			this.execute ();
		}, msElapsed);
	}

}

module.exports = RepeatTask;
