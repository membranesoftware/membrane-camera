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
// ffmpeg utility functions

"use strict";

const App = global.App || { };
const Path = require ("path");
const OsUtil = require (Path.join (App.SOURCE_DIRECTORY, "OsUtil"));
const ExecProcess = require (Path.join (App.SOURCE_DIRECTORY, "ExecProcess"));

// Return a newly created ExecProcess object that launches ffmpeg. workingPath defaults to the application data directory if empty.
exports.createFfmpegProcess = (runArgs, workingPath, processData, processEnded) => {
	let runpath;

	runpath = App.FfmpegPath;
	const env = { };
	if (runpath == "") {
		if (OsUtil.isWindows) {
			runpath = "ffmpeg/bin/ffmpeg.exe";
		}
		else if (OsUtil.isLinux) {
			runpath = "ffmpeg/ffmpeg";
			env.LD_LIBRARY_PATH = `${App.BIN_DIRECTORY}/ffmpeg/lib`;
		}
		else {
			runpath = "ffmpeg";
		}
	}

	const proc = new ExecProcess (runpath, runArgs);
	proc.env = env;
	if (typeof workingPath == "string") {
		proc.workingPath = workingPath;
	}
	if (typeof processData == "function") {
		proc.onReadLines (processData);
	}
	if (typeof processEnded == "function") {
		proc.onEnd (processEnded);
	}
	return (proc);
};

// Run the ffmpeg process and return the isExitSuccess boolean value. workingPath defaults to the application data directory if empty.
exports.runFfmpeg = async (runArgs, workingPath, processData) => {
	const result = await new Promise ((resolve, reject) => {
		const processEnded = (err, isExitSuccess) => {
			if (err != null) {
				reject (err);
				return;
			}
			resolve (isExitSuccess);
		};
		exports.createFfmpegProcess (runArgs, workingPath, processData, processEnded);
	});
	return (result);
};

// Return a newly created ExecProcess object that launches ffprobe. workingPath defaults to the application data directory if empty.
exports.createFfprobeProcess = (runArgs, workingPath, processData, processEnded) => {
	let runpath;

	runpath = App.FfmpegPath;
	const env = { };
	if (runpath == "") {
		if (OsUtil.isWindows) {
			runpath = "ffmpeg/bin/ffprobe.exe";
		}
		else if (OsUtil.isLinux) {
			runpath = "ffmpeg/ffprobe";
			env.LD_LIBRARY_PATH = `${App.BIN_DIRECTORY}/ffmpeg/lib`;
		}
		else {
			runpath = "ffprobe";
		}
	}

	const proc = new ExecProcess (runpath, runArgs);
	proc.env = env;
	if (typeof workingPath == "string") {
		proc.workingPath = workingPath;
	}
	if (typeof processData == "function") {
		proc.onReadLines (processData);
	}
	if (typeof processEnded == "function") {
		proc.onEnd (processEnded);
	}
	return (proc);
};

// Run the ffprobe process and return the isExitSuccess boolean value. workingPath defaults to the application data directory if empty.
exports.runFfprobe = async (runArgs, workingPath, processData) => {
	const result = await new Promise ((resolve, reject) => {
		const processEnded = (err, isExitSuccess) => {
			if (err != null) {
				reject (err);
				return;
			}
			resolve (isExitSuccess);
		};
		exports.createFfprobeProcess (runArgs, workingPath, processData, processEnded);
	});
	return (result);
};
