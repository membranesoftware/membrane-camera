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
// Utility functions for Task objects

"use strict";

const App = global.App || { };
const Result = require (App.SOURCE_DIRECTORY + "/Result");
const TaskTypes = require ('./types');

function Task () {

}

module.exports = Task;

Task.TaskTypes = TaskTypes;
exports.TaskTypes = TaskTypes;

// createTask - Create a new task of the specified type name and configure it with the provided parameters object. Returns null if the task could not be created, indicating that the type name was not found or the configuration was not valid.
Task.createTask = function (typeName, configureParams) {
	let tasktype, task;

	tasktype = Task.TaskTypes[typeName];
	if (tasktype == null) {
		return (null);
	}

	task = new tasktype ();
	if ((typeof configureParams != "object") || (configureParams == null)) {
		configureParams = { };
	}
	if (task.configure (configureParams) != Result.SUCCESS) {
		return (null);
	}

	return (task);
};

// executeTask - Execute a task of the specified type name and configuration and invoke the provided callback when complete, with "err" and "resultObject" parameters. If no callback is provided, instead return a promise that resolves if the task succeeds or rejects if it doesn't.
Task.executeTask = function (typeName, configureParams, endCallback) {
	let execute = (executeCallback) => {
		let task;

		task = Task.createTask (typeName, configureParams);
		if (task == null) {
			executeCallback ("Invalid task configuration", null);
			return;
		}

		task.endCallback = () => {
			if (! task.isSuccess) {
				executeCallback ("Task completed with non-success result", null);
				return;
			}

			executeCallback (null, task.resultObject);
		};

		task.run ();
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, resultObject) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve (resultObject);
			});
		}));
	}
};
