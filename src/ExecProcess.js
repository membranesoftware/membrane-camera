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
// Class that runs a child process and emits events as lines of data are generated

"use strict";

const App = global.App || { };
const ChildProcess = require ("child_process");
const Log = require (App.SOURCE_DIRECTORY + "/Log");

const STOP_SIGNAL_REPEAT_DELAY = 4800; // milliseconds

class ExecProcess {
	// execPath is the path to the binary to run, execArgs is an array containing command line arguments for the child process, envParams is an object containing environment variables for the child process, workingPath is the path to the working directory for process execution (defaults to the application data directory if empty), dataCallback is a function that should be called each time a set of lines is parsed (invoked with an array of strings and a callback), and endCallback is a function that should be called when the process ends (invoked with err and isExitSuccess parameters).
	constructor (execPath, execArgs, envParams, workingPath, dataCallback, endCallback) {
		// Read-only data members
		this.isPaused = false;
		this.isEnded = false;
		this.exitCode = -1;
		this.exitSignal = "";
		this.isExitSuccess = false;

		this.execPath = execPath;
		if (this.execPath.indexOf ("/") !== 0) {
			this.execPath = App.BIN_DIRECTORY + "/" + this.execPath;
		}

		this.workingPath = workingPath;
		if ((typeof this.workingPath != "string") || (this.workingPath == "")) {
			this.workingPath = App.DATA_DIRECTORY;
		}

		if ((typeof envParams != "object") || (envParams == null)) {
			envParams = { };
		}
		this.envParams = envParams;

		if (! Array.isArray (execArgs)) {
			execArgs = [ ];
		}
		this.execArgs = execArgs;

		this.dataCallback = dataCallback;
		this.endCallback = endCallback;
		this.process = null;
		this.runProcess ();
	}

	// Run the configured process
	runProcess () {
		let proc, endcount, ended, endRun;

		try {
			proc = ChildProcess.spawn (this.execPath, this.execArgs, {
				cwd: this.workingPath,
				env: this.envParams
			});
		}
		catch (err) {
			Log.err (`Failed to launch child process; execPath=${this.execPath} execArgs=${JSON.stringify (this.execArgs)} workingPath=${this.workingPath} env=${JSON.stringify (this.envParams)} err=${err}\n${err.stack}`);

			if (this.endCallback != null) {
				setTimeout (() => {
					this.endCallback (err, false);
				}, 0);
			}
			return;
		}
		this.process = proc;
		endcount = 0;
		this.isEnded = false;
		this.exitCode = -1;
		this.exitSignal = "";
		this.isExitSuccess = false;
		this.readLineCount = 0;
		this.readByteCount = 0;
		this.stdoutBuffer = "";
		this.stderrBuffer = "";

		proc.stdout.on ("data", (data) => {
			this.stdoutBuffer += data.toString ();
			this.readByteCount += data.length;
			this.parseBuffer ();
		});

		proc.stdout.on ("end", () => {
			++endcount;
			if (endcount >= 3) {
				endRun ();
			}
		});

		proc.stderr.on ("data", (data) => {
			this.stderrBuffer += data.toString ();
			this.readByteCount += data.length;
			this.parseBuffer ();
		});

		proc.stderr.on ("end", () => {
			++endcount;
			if (endcount >= 3) {
				endRun ();
			}
		});

		proc.on ("error", (err) => {
			Log.err (`[ExecProcess ${proc.pid}] process error; execPath=${this.execPath} err=${err}`);
			endRun (err);
		});

		proc.on ("close", (code, signal) => {
			this.exitCode = code;
			this.exitSignal = (typeof signal == "string") ? signal : "";
			this.isExitSuccess = (this.exitCode == 0);
			++endcount;
			if (endcount >= 3) {
				endRun ();
			}
		});

		endRun = (err) => {
			if (this.isEnded) {
				return;
			}
			this.isEnded = true;
			if (err != null) {
				if (this.endCallback != null) {
					this.endCallback (err, this.isExitSuccess);
					this.endCallback = null;
				}
				return;
			}

			if (! this.isPaused) {
				this.parseBuffer ();
			}
		};
	}

	// Pause the process's input events
	pauseEvents () {
		if (this.process == null) {
			return;
		}

		this.isPaused = true;
		this.process.stdout.pause ();
		this.process.stderr.pause ();
	}

	// Resume the process's input events
	resumeEvents () {
		if (this.process == null) {
			return;
		}

		this.process.stdout.resume ();
		this.process.stderr.resume ();
		this.isPaused = false;
	}

	// Parse any data contained in process buffers
	parseBuffer () {
		let pos, line, lines, endParse;

		endParse = () => {
			if (this.isPaused) {
				this.resumeEvents ();
			}

			if (this.isEnded) {
				if (this.endCallback != null) {
					this.endCallback (null, this.isExitSuccess);
					this.endCallback = null;
				}
			}
		};

		lines = [ ];
		while (true) {
			pos = this.stdoutBuffer.indexOf ("\n");
			if (pos < 0) {
				break;
			}

			line = this.stdoutBuffer.substring (0, pos);
			this.stdoutBuffer = this.stdoutBuffer.substring (pos + 1);

			lines.push (line);
			++(this.readLineCount);
		}

		while (true) {
			pos = this.stderrBuffer.indexOf ("\n");
			if (pos < 0) {
				break;
			}

			line = this.stderrBuffer.substring (0, pos);
			this.stderrBuffer = this.stderrBuffer.substring (pos + 1);

			lines.push (line);
			++(this.readLineCount);
		}

		if (lines.length <= 0) {
			endParse ();
			return;
		}

		this.pauseEvents ();
		if (this.dataCallback != null) {
			this.dataCallback (lines, () => {
				endParse ();
			});
		}
		else {
			process.nextTick (endParse);
		}
	}

	// Stop the process
	stop () {
		let pid, repeatKill;

		if (this.isEnded) {
			return;
		}

		pid = this.process.pid;
		this.process.kill ("SIGTERM");
		repeatKill = () => {
			if (this.isEnded) {
				return;
			}
			this.process.kill ("SIGKILL");
		};
		setTimeout (repeatKill, STOP_SIGNAL_REPEAT_DELAY);
	}
}

module.exports = ExecProcess;
