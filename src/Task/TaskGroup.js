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
// Class that manages a group of tasks and runs them in a queue

"use strict";

const App = global.App || { };
const EventEmitter = require ("events").EventEmitter;
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const SystemInterface = require (App.SOURCE_DIRECTORY + "/SystemInterface");
const RepeatTask = require (App.SOURCE_DIRECTORY + "/RepeatTask");
const Task = require (App.SOURCE_DIRECTORY + "/Task/Task");

class TaskGroup {
	constructor () {
		// Read-write data members
		this.maxRunCount = 1;

		this.taskMap = { };

		// A map of task ID values to cached TaskItem objects, used to publish event record updates
		this.taskRecordMap = { };

		this.eventEmitter = new EventEmitter ();
		this.eventEmitter.setMaxListeners (0);
		this.updateTask = new RepeatTask ();
	}

	// Start the task group's operation
	start () {
		this.updateTask.setRepeating ((callback) => {
			this.update (callback);
		}, App.HEARTBEAT_PERIOD, App.HEARTBEAT_PERIOD * 2);
	}

	// Stop the task group's operation
	stop () {
		this.updateTask.stop ();
	}

	// Update the task group's run state and execute the provided callback when complete
	update (endCallback) {
		let mintask, items, mapitem, taskitem, shouldremove, shouldwrite, cmd;

		while (true) {
			if (this.getRunCount () >= this.maxRunCount) {
				break;
			}

			mintask = null;
			for (let task of Object.values (this.taskMap)) {
				if (task.isRunning || (task.startTime > 0)) {
					continue;
				}

				if ((mintask == null) || (task.createTime < mintask.createTime)) {
					mintask = task;
				}
			}

			if (mintask == null) {
				break;
			}

			mintask.run ();
			if (! mintask.isRunning) {
				this.removeTask (mintask.id);
			}
		}

		for (let task of Object.values (this.taskMap)) {
			taskitem = task.getTaskItem ();
			mapitem = this.taskRecordMap[task.id];

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
				cmd = SystemInterface.createCommand (App.systemAgent.getCommandPrefix (), "TaskItem", SystemInterface.Constant.Admin, taskitem);
				if (! SystemInterface.isError (cmd)) {
					this.eventEmitter.emit (task.id, cmd);
				}
			}
		}

		items = Object.values (this.taskMap);
		for (let task of items) {
			shouldremove = false;
			if ((task.startTime > 0) && (task.endTime > 0)) {
				shouldremove = true;
			}
			else if ((task.startTime <= 0) && task.isCancelled) {
				shouldremove = true;
			}

			if (shouldremove) {
				this.removeTask (task.id);
			}
		}

		process.nextTick (endCallback);
	}

	// Add a task to the run queue, assigning its ID value in the process. If endCallback is provided, set the task to invoke that function when it completes.
	runTask (task, endCallback) {
		task.id = App.systemAgent.getUuid (SystemInterface.CommandId.TaskItem);
		this.taskMap[task.id] = task;

		if (typeof endCallback == "function") {
			task.endCallback = endCallback;
		}
		this.updateTask.setNextRepeat (0);
	}

	// Cancel a task, as specified in the provided CancelTask command
	cancelTask (cmdInv) {
		let task;

		task = this.taskMap[cmdInv.params.taskId];
		if (task == null) {
			return;
		}

		task.cancel ();
		this.updateTask.setNextRepeat (0);
	}

	// Handle a ReadTasks command received from a link client
	readTasks (client, cmdInv) {
		let cmd;

		for (let task of Object.values (this.taskMap)) {
			cmd = SystemInterface.createCommand (App.systemAgent.getCommandPrefix (), "TaskItem", SystemInterface.Constant.Admin, task.getTaskItem ());
			if (SystemInterface.isError (cmd)) {
				Log.err (`Failed to create TaskItem command: ${cmd}`);
				continue;
			}
			client.emit (SystemInterface.Constant.WebSocketEvent, cmd);
		}
	}

	// Handle a WatchTasks command received from a link client
	watchTasks (client, cmdInv) {
		let addListener;

		addListener = (taskId) => {
			let execute;

			execute = (taskItemCommand) => {
				client.emit (SystemInterface.Constant.WebSocketEvent, taskItemCommand);
			};

			this.eventEmitter.addListener (taskId, execute);
			client.once ("disconnect", () => {
				this.eventEmitter.removeListener (taskId, execute);
			});
		};

		for (let id of cmdInv.params.taskIds) {
			addListener (id);
		}
	}

	// Return the task with the specified ID, or null if no such task was found
	getTask (taskId) {
		return (this.taskMap[taskId]);
	}

	// Remove the specified task from the task map and associated components
	removeTask (taskId) {
		delete (this.taskMap[taskId]);
		delete (this.taskRecordMap[taskId]);
		this.eventEmitter.removeAllListeners (taskId);
	}

	// Return the number of tasks in the group
	getTaskCount () {
		return (Object.keys (this.taskMap).length);
	}

	// Return the number of tasks currently running
	getRunCount () {
		let count;

		count = 0;
		for (let task of Object.values (this.taskMap)) {
			if (task.isRunning) {
				++count;
			}
		}

		return (count);
	}
}

module.exports = TaskGroup;
