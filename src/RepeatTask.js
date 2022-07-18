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
// Class that manages periodic and on-demand execution of a function

"use strict";

class RepeatTask {
	constructor () {
		this.taskFunction = (callback) => {
			process.nextTick (callback);
		};
		this.isExecuting = false;
		this.executeTimeout = null;
		this.isRepeating = false;
		this.isSuspended = false;
		this.nextExecuteTime = 0;
		this.nextRepeatPeriod = 0;
		this.minIntervalPeriod = 1000;
		this.maxIntervalPeriod = 2000;
		this.isAsync = false;
		this.catchFn = (err) => { };
		this.idleCallbacks = [ ];
	}

	// Set the task to execute its function using async/await, with catchFn as the catch function for thrown errors
	setAsync (catchFn) {
		this.isAsync = true;
		this.catchFn = catchFn;
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
		if (typeof maxIntervalPeriod == "number") {
			this.maxIntervalPeriod = maxIntervalPeriod;
		}
		else {
			this.maxIntervalPeriod = minIntervalPeriod;
		}

		if (shouldexecute) {
			this.setNextRepeat (0);
		}
	}

	// Set the task for repeated execution on demand, as controlled by calls to setNextRepeat or advanceNextRepeat. Task execution is performed using taskFunction, which must expect a single "callback" parameter for invocation when the task completes.
	setOnDemand (taskFunction) {
		this.isRepeating = false;
		this.isSuspended = false;
		this.taskFunction = taskFunction;
		if (this.executeTimeout != null) {
			clearTimeout (this.executeTimeout);
			this.executeTimeout = null;
		}
	}

	// Execute the task
	execute () {
		if (this.isExecuting) {
			return;
		}
		if (this.executeTimeout != null) {
			clearTimeout (this.executeTimeout);
			this.executeTimeout = null;
		}
		this.isExecuting = true;
		this.nextRepeatPeriod = 0;
		this.nextExecuteTime = 0;

		const endTask = () => {
			let delay;

			this.isExecuting = false;

			for (const fn of this.idleCallbacks) {
				setImmediate (fn);
			}
			this.idleCallbacks = [ ];

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
				this.setExecuteTimeout (delay);
			}
		};

		if (this.isAsync) {
			this.taskFunction (this).catch (this.catchFn).then (endTask);
		}
		else {
			this.taskFunction (endTask, this);
		}
	}

	// Cancel any repeating execution that might be configured and clear the task function
	stop () {
		this.isRepeating = false;
		if (this.isAsync) {
			this.taskFunction = async () => { };
		}
		else {
			this.taskFunction = (callback) => {
				process.nextTick (callback);
			};
		}
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

	// Set the task's next repeat execution to occur after the specified millisecond delay
	setNextRepeat (msElapsed) {
		this.isSuspended = false;
		if (this.isExecuting) {
			this.nextRepeatPeriod = msElapsed;
			return;
		}
		this.setExecuteTimeout (msElapsed);
	}

	// Set the task's next repeat execution to occur after the specified millisecond delay. If a repeat execution is already scheduled, change its timeout to msElapsed only if that would cause the task to execute sooner.
	advanceNextRepeat (msElapsed) {
		if (this.isExecuting) {
			if ((this.nextRepeatPeriod > 0) && (msElapsed < this.nextRepeatPeriod)) {
				this.nextRepeatPeriod = msElapsed;
			}
			return;
		}
		if ((this.executeTimeout != null) && ((this.nextExecuteTime - Date.now ()) <= msElapsed)) {
			return;
		}
		this.setExecuteTimeout (msElapsed);
	}

	// Set executeTimeout to execute the task after the specified millisecond delay
	setExecuteTimeout (msElapsed) {
		if (this.executeTimeout != null) {
			clearTimeout (this.executeTimeout);
		}
		this.executeTimeout = setTimeout (() => {
			this.execute ();
		}, msElapsed);
		this.executeTimeout.unref ();
		this.nextExecuteTime = Date.now () + msElapsed;
	}

	// Execute callback at the next time the task is not executing
	onIdle (callback) {
		if (! this.isExecuting) {
			callback ();
			return;
		}
		this.idleCallbacks.push (callback);
	}

	// Return a promise that resolves when the task is not executing
	async awaitIdle () {
		await new Promise ((resolve, reject) => {
			if (! this.isExecuting) {
				resolve ();
				return;
			}
			this.idleCallbacks.push (resolve);
		});
	}
}
module.exports = RepeatTask;
