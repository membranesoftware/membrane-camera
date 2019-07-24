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
"use strict";

const App = global.App || { };
const Path = require ("path");
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const FsUtil = require (App.SOURCE_DIRECTORY + "/FsUtil");
const SystemInterface = require (App.SOURCE_DIRECTORY + "/SystemInterface");
const TaskBase = require (App.SOURCE_DIRECTORY + "/Task/TaskBase");

class GetDiskSpace extends TaskBase {
	constructor () {
		super ();
		this.name = "Get disk space";
		this.description = "Gather data regarding available disk space for a target path and generate a result object with number fields \"total\", \"used\", and \"free\", specified in bytes";

		this.configureParams = [
			{
				name: "targetPath",
				type: "string",
				flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.NotEmpty,
				description: "The path to the target directory for the operation"
			}
		];

		this.runSourcePath = Path.join (App.BIN_DIRECTORY, "GetDiskSpace_" + process.platform + ".js");
	}

	// Subclass method. Implementations should execute task actions and call end when complete.
	doRun () {
		FsUtil.fileExists (this.runSourcePath).then ((exists) => {
			let fn;

			try {
				fn = require (this.runSourcePath);
			}
			catch (e) {
				return (Promise.reject (e));
			}

			return (fn (this));
		}).then ((data) => {
			this.resultObject = data;
			this.setPercentComplete (100);
			this.isSuccess = true;
		}).catch ((err) => {
			Log.debug (`${this.toString ()} failed; err=${err}`);
		}).then (() => {
			this.end ();
		});
	}
}
module.exports = GetDiskSpace;
