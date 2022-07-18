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
// Class that runs a queue of tasks

"use strict";

const App = global.App || { };
const Path = require ("path");
const EventEmitter = require ("events").EventEmitter;
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const RepeatTask = require (Path.join (App.SOURCE_DIRECTORY, "RepeatTask"));

const IdleEvent = "idle";

class TaskGroup {
	constructor () {
		// Read-only data members
		this.taskCount = 0;
		this.runCount = 0;
		this.runTaskName = "";
		this.runTaskSubtitle = "";
		this.runTaskPercentComplete = 0;

		// Read-write data members
		this.maxRunCount = 1;

		this.taskList = [ ];
		this.taskMap = { };

		// A map of task ID values to cached TaskItem objects, used to publish event record updates
		this.taskRecordMap = { };

		this.statusEventEmitter = new EventEmitter ();
		this.statusEventEmitter.setMaxListeners (0);
		this.watchEventEmitter = new EventEmitter ();
		this.watchEventEmitter.setMaxListeners (0);
		this.updateTask = new RepeatTask ();
	}

	// Start the task group's operation
	start () {
		this.updateTask.setRepeating ((callback) => {
			this.update (callback);
		}, App.HeartbeatPeriod, App.HeartbeatPeriod * 2);
	}

	// Stop the task group's operation
	stop () {
		this.updateTask.stop ();
	}

	// Execute the provided callback on the next run list empty event
	onIdle (callback) {
		if (Object.keys (this.taskMap).length <= 0) {
			setImmediate (callback);
			return;
		}
		this.statusEventEmitter.once (IdleEvent, callback);
	}

	// Wait until the next run list empty event occurs
	async awaitIdle () {
		if (Object.keys (this.taskMap).length <= 0) {
			return;
		}
		await new Promise ((resolve, reject) => {
			if (Object.keys (this.taskMap).length <= 0) {
				resolve ();
				return;
			}
			this.statusEventEmitter.once (IdleEvent, resolve);
		});
	}

	// Add a task to the run queue and return the ID value that was assigned to the task
	run (task) {
		const taskid = App.systemAgent.getUuid (SystemInterface.CommandId.TaskItem);
		task.id = taskid;
		this.taskList.push (task);
		this.taskMap[task.id] = task;
		if (this.runCount < this.maxRunCount) {
			setImmediate (() => {
				this.executeNextTask ();
			});
		}
		this.updateTask.setNextRepeat (0);
		return (taskid);
	}

	// Add a task to the run queue, wait for it to end, and return the task object
	async awaitRun (task) {
		this.run (task);
		await this.awaitTaskEnd (task.id);
		return (task);
	}

	// Invoke callback on completion of any task matching taskId, or immediately if no such task exists
	onTaskEnd (taskId, callback) {
		const task = this.taskMap[taskId];
		if (task == null) {
			setImmediate (callback);
			return;
		}
		const onEvent = () => {
			if (task.isEnded || (this.taskMap[task.id] === undefined)) {
				callback ();
				return;
			}
			this.statusEventEmitter.once (task.id, onEvent);
		};
		this.statusEventEmitter.once (task.id, onEvent);
	}

	// Wait until completion of any task matching taskId
	async awaitTaskEnd (taskId) {
		const task = this.taskMap[taskId];
		if (task == null) {
			return;
		}
		while (! task.isEnded) {
			await new Promise ((resolve, reject) => {
				if (task.isEnded || (this.taskMap[task.id] === undefined)) {
					resolve ();
					return;
				}
				this.statusEventEmitter.once (task.id, resolve);
			});
		}
	}

	// Cancel a task, as specified in the provided CancelTask command
	cancelTask (cmdInv) {
		const task = this.taskMap[cmdInv.params.taskId];
		if (task == null) {
			return;
		}
		const pos = this.taskList.indexOf (task);
		if (pos >= 0) {
			this.taskList.splice (pos, 1);
		}
		if (! task.isCancelled) {
			task.isCancelled = true;
			if (task.isRunning) {
				task.cancel ().catch ((err) => {
					Log.debug (`Task cancel operation failed; task=${task.toString ()} err=${err}`);
				});
			}
		}
		this.updateTask.setNextRepeat (0);
	}

	// Handle a ReadTasks command received from a link client
	readTasks (cmdInv, client) {
		for (const task of Object.values (this.taskMap)) {
			const cmd = App.systemAgent.createCommand (SystemInterface.CommandId.TaskItem, task.getTaskItem ());
			if (cmd != null) {
				client.emit (SystemInterface.Constant.WebSocketEvent, cmd);
			}
		}
	}

	// Handle a WatchTasks command received from a link client
	watchTasks (cmdInv, client) {
		const addListener = (taskId) => {
			const execute = (taskItemCommand) => {
				client.emit (SystemInterface.Constant.WebSocketEvent, taskItemCommand);
			};
			this.watchEventEmitter.addListener (taskId, execute);
			client.once ("disconnect", () => {
				this.watchEventEmitter.removeListener (taskId, execute);
			});
		};

		for (const id of cmdInv.params.taskIds) {
			addListener (id);
		}
	}

	// Execute the next item from taskList
	executeNextTask () {
		if (this.taskList.length <= 0) {
			return;
		}
		if (this.runCount >= this.maxRunCount) {
			return;
		}

		const task = this.taskList.shift ();
		++(this.runCount);
		this.executeTask (task).catch ((err) => {
			Log.debug (`TaskGroup failed to execute task; ${task.toString ()} err=${err}`);
		}).then (() => {
			if ((this.taskList.length > 0) && (this.runCount < this.maxRunCount)) {
				setImmediate (() => {
					this.executeNextTask ();
				});
			}
		});
	}

	// Execute task as a run item
	async executeTask (task) {
		task.isRunning = true;
		task.startTime = Date.now ();
		task.setPercentComplete (0);
		this.updateTask.setNextRepeat (0);
		try {
			task.cancelBreak ();
			await task.run ();
			if (task.isCancelled) {
				task.isSuccess = false;
			}
		}
		catch (err) {
			task.isSuccess = false;
			task.runError = err.stack;
			Log.debug (`Task execute failed ${task.toString ()} err=${err}`);
		}
		try {
			await task.end ();
		}
		catch (err) {
			Log.debug (`Task end failed ${task.toString ()} err=${err}`);
		}
		if (task.resultObject == null) {
			task.resultObject = { };
		}
		if (task.isSuccess && (task.resultObjectType != "")) {
			const result = SystemInterface.parseTypeObject (task.resultObjectType, task.resultObject);
			if (SystemInterface.isError (result)) {
				task.isSuccess = false;
				Log.debug (`${task.toString ()} result object failed validation; resultObjectType=${task.resultObjectType} err=${result}`);
			}
		}

		task.endTime = Date.now ();
		task.isRunning = false;
		task.isEnded = true;
		--(this.runCount);
		this.statusEventEmitter.emit (task.id);
		this.updateTask.setNextRepeat (0);
	}

	// Update the task group's run state and execute the provided callback when complete
	update (endCallback) {
		let shouldremove, shouldwrite;

		const items = Object.values (this.taskMap);
		for (const task of items) {
			const taskitem = task.getTaskItem ();
			const mapitem = this.taskRecordMap[task.id];
			shouldwrite = false;
			if (mapitem == null) {
				shouldwrite = true;
			}
			else {
				if ((! shouldwrite) && (mapitem.percentComplete != taskitem.percentComplete)) {
					shouldwrite = true;
				}
				if ((! shouldwrite) && (mapitem.isRunning != taskitem.isRunning)) {
					shouldwrite = true;
				}
				if ((! shouldwrite) && (mapitem.endTime != taskitem.endTime)) {
					shouldwrite = true;
				}
			}
			this.taskRecordMap[task.id] = taskitem;

			if (shouldwrite) {
				const cmd = App.systemAgent.createCommand (SystemInterface.CommandId.TaskItem, taskitem);
				if (cmd != null) {
					this.watchEventEmitter.emit (task.id, cmd);
				}
			}
		}

		this.runTaskName = "";
		this.runTaskSubtitle = "";
		this.runTaskPercentComplete = 0;
		for (const task of items) {
			shouldremove = false;
			if (task.isEnded) {
				shouldremove = true;
			}
			else if ((task.startTime <= 0) && task.isCancelled) {
				shouldremove = true;
			}
			if (shouldremove) {
				const count = Object.keys (this.taskMap).length;
				delete (this.taskMap[task.id]);
				delete (this.taskRecordMap[task.id]);
				this.watchEventEmitter.removeAllListeners (task.id);
				if ((count > 0) && (Object.keys (this.taskMap).length <= 0)) {
					this.statusEventEmitter.emit (IdleEvent);
				}
				continue;
			}

			if ((this.runTaskName == "") && (task.name != "")) {
				this.runTaskName = task.name;
				this.runTaskSubtitle = task.subtitle;
				this.runTaskPercentComplete = task.getPercentComplete ();
			}
		}

		this.taskCount = Object.keys (this.taskMap).length;
		if (this.taskCount <= 0) {
			this.updateTask.suspendRepeat ();
		}
		setImmediate (endCallback);
	}
}
module.exports = TaskGroup;
