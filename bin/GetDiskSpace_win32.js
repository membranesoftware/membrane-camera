"use strict";

var App = global.App || { };
var ExecProcess = require (App.SOURCE_DIRECTORY + "/ExecProcess");

// Return a promise that executes the operation. If successful, the promise resolves with number fields "total", "used", and "free", specified in bytes.
module.exports = function (task) {
	return (new Promise ((resolve, reject) => {
		let proc, found, total, used, free;

		found = false;
		total = 0;
		used = 0;
		free = 0;
		proc = new ExecProcess ("df.exe", [ task.configureMap.targetPath ], { }, null, processData, processEnded);
		function processData (lines, dataParseCallback) {
			let m;

			for (let line of lines) {
				if (found) {
					break;
				}
				m = line.match (/^([0-9]+)\s+([0-9]+)\s+([0-9]+)/);
				if (m != null) {
					total = parseInt (m[1], 10) * 1024;
					used = parseInt (m[2], 10) * 1024;
					free = parseInt (m[3], 10) * 1024;
					found = true;
				}
			}

			process.nextTick (dataParseCallback);
		}

		function processEnded () {
			if (! found) {
				reject (Error ("Failed to gather disk space data"));
			}
			else {
				resolve ({
					total: total,
					used: used,
					free: free
				});
			}
		}
	}));
};
