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
"use strict";

const App = global.App || { };
const Path = require ("path");
const OsUtil = require (Path.join (App.SOURCE_DIRECTORY, "OsUtil"));
const Task = require (Path.join (App.SOURCE_DIRECTORY, "Task", "Task"));

class GetDiskSpaceTask extends Task {
	constructor (configureMap) {
		super (configureMap);
		this.name = App.uiText.getText ("GetDiskSpaceTaskName");
	}

	async run () {
		let execpath, processData, found, total, used, free;

		if ((typeof this.configureMap.targetPath !== "string") || (this.configureMap.targetPath.length <= 0)) {
			throw Error ("Missing configuration value: targetPath");
		}
		const execargs = [ ];
		if (OsUtil.isWindows) {
			execpath = "df.exe";
			processData = (lines, dataParseCallback) => {
				for (const line of lines) {
					if (found) {
						break;
					}
					const m = line.match (/^([0-9]+)\s+([0-9]+)\s+([0-9]+)/);
					if (m != null) {
						total = parseInt (m[1], 10) * 1024;
						used = parseInt (m[2], 10) * 1024;
						free = parseInt (m[3], 10) * 1024;
						found = true;
					}
				}
				process.nextTick (dataParseCallback);
			};
		}
		else {
			execpath = "/bin/df";
			execargs.push ("-k");
			processData = (lines, dataParseCallback) => {
				for (const line of lines) {
					if (found) {
						break;
					}
					const m = line.match (/^(.*?)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)/);
					if (m != null) {
						total = parseInt (m[2], 10) * 1024;
						used = parseInt (m[3], 10) * 1024;
						free = parseInt (m[4], 10) * 1024;
						found = true;
					}
				}
				process.nextTick (dataParseCallback);
			};
		}
		execargs.push (this.configureMap.targetPath);

		const isExitSuccess = await App.systemAgent.runProcess (execpath, execargs, { }, null, processData);
		if (! isExitSuccess) {
			throw Error ("df process failed");
		}
		if (! found) {
			throw Error ("failed to gather disk space data");
		}
		this.resultObject = {
			total: total,
			used: used,
			free: free
		};
		this.setPercentComplete (100);
		this.isSuccess = true;
	}
}
module.exports = GetDiskSpaceTask;
