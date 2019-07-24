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
// Class that handles storage of data records using MongoDB

"use strict";

const App = global.App || { };
const Mongo = require ("mongodb").MongoClient;
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const FsUtil = require (App.SOURCE_DIRECTORY + "/FsUtil");
const ExecProcess = require (App.SOURCE_DIRECTORY + "/ExecProcess");

class DataStore {
	constructor (runPath, dataPath, listenPort) {
		// Read-only data members
		this.isRunning = false;
		this.dbUrl = "";

		// Read-write data members
		this.dbHost = App.STORE_HOST;
		this.dbUsername = App.STORE_USERNAME;
		this.dbPassword = App.STORE_PASSWORD;
		this.dbName = App.STORE_DATABASE;
		this.collectionName = App.STORE_COLLECTION;

		this.storeRunPath = "/usr/bin/mongod";
		if (typeof runPath == "string") {
			this.storeRunPath = runPath;
		}

		this.storeDataPath = App.DATA_DIRECTORY + "/datastore";
		if (typeof dataPath == "string") {
			this.storeDataPath = dataPath;
		}

		this.storeListenPort = 27017;
		if (typeof listenPort == "number") {
			this.storeListenPort = listenPort;
		}

		this.storeProcess = null;
		this.mongo = null;
	}

	// Return a promise that launches the data store process if it isn't already running
	run () {
		return (new Promise ((resolve, reject) => {
			let started, proc, storeProcessData, storeProcessEnded;
			if (this.storeProcess != null) {
				resolve ();
				return;
			}

			started = false;
			FsUtil.createDirectory (this.storeDataPath).then (() => {
				let conf;

				conf = `dbpath=${this.storeDataPath}\n`;
				conf += `bind_ip=127.0.0.1\n`;
				conf += `journal=false\n`;
				conf += `auth=false\n`;
				conf += `port=${this.storeListenPort}\n`;
				return (FsUtil.writeFile (`${this.storeDataPath}/mongod.conf`, conf, { mode: 0o600 }));
			}).then (() => {
				proc = new ExecProcess (this.storeRunPath, [ "-f", `${this.storeDataPath}/mongod.conf` ], { }, this.storeDataPath, storeProcessData, storeProcessEnded);
				this.storeProcess = proc;
			}).catch ((err) => {
				reject (err);
			});

			storeProcessData = (lines, dataParseCallback) => {
				if (! started) {
					for (let line of lines) {
						if (line.indexOf ("waiting for connections on port " + this.storeListenPort) >= 0) {
							started = true;
							break;
						}
					}

					if (started) {
						this.isRunning = true;
						resolve ();
					}
				}

				process.nextTick (dataParseCallback);
			};

			storeProcessEnded = (err, isExitSuccess) => {
				if (! started) {
					reject (Error ("Store process ended unexpectedly"));
				}

				this.isRunning = false;
				if (this.storeProcess == proc) {
					this.storeProcess = null;
				}
			};
		}));
	}

	// Stop the data store process
	stop () {
		this.isRunning = false;
		this.close ();
		if (this.storeProcess != null) {
			this.storeProcess.stop ();
			this.storeProcess = null;
		}
	}

	// Open the data store and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred). If a callback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
	open (endCallback) {
		let execute = (executeCallback) => {
			let connectComplete, authenticateComplete;

			if (this.mongo != null) {
				process.nextTick (executeCallback);
				return;
			}

			this.dbUrl = "mongodb://" + this.dbHost + ":" + this.storeListenPort + "/" + this.dbName;

			setTimeout (() => {
				Mongo.connect (this.dbUrl, { useNewUrlParser: true }, connectComplete);
			}, 0);
			connectComplete = (err, mongo) => {
				if (err != null) {
					executeCallback (err);
					return;
				}

				this.mongo = mongo;
				if ((typeof this.dbUsername == "string") && (typeof this.dbPassword == "string") && (this.dbUsername != "") && (this.dbPassword != "")) {
					this.mongo.authenticate (this.dbUsername, this.dbPassword, authenticateComplete);
				}
				else {
					authenticateComplete (null, null);
				}
			};

			authenticateComplete = (err, res) => {
				if (err != null) {
					this.mongo.close ();
					this.mongo = null;
					executeCallback (err);
					return;
				}
				executeCallback ();
			}
		};

		if (typeof endCallback == "function") {
			execute (endCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve ();
				});
			}));
		}
	}

	// Close the data store
	close () {
		if (this.mongo != null) {
			this.mongo.close ();
			this.mongo = null;
		}
	}

	// Store a record and invoke the provided callback when complete, with an "err" parameter. If a callback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
	storeRecord (record, endCallback) {
		let execute = (executeCallback) => {
			let db, collection;

			if (this.mongo == null) {
				executeCallback ("Store connection not established");
				return;
			}

			db = this.mongo.db (this.dbName);
			collection = db.collection (this.collectionName);
			collection.insert (record, (err, result) => {
				executeCallback (err);
			});
		};

		if (typeof endCallback == "function") {
			execute (endCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve ();
				});
			}));
		}
	}

	// Update records and invoke the provided callback when complete, with an "err" parameter. If a callback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
	updateRecords (criteria, update, options, endCallback) {
		let execute = (executeCallback) => {
			let db, collection;

			if (this.mongo == null) {
				process.nextTick (() => {
					executeCallback ("Store connection not established");
				});
				return;
			}

			db = this.mongo.db (this.dbName);
			collection = db.collection (this.collectionName);
			collection.update (criteria, update, options, executeCallback);
		};

		if (typeof endCallback == "function") {
			execute (endCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err, result) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve (result);
				});
			}));
		}
	}

	// Check if a record matching the specified MongoDB criteria exists. Invokes the provided callback when complete, with "err" and "recordCount" parameters. If a callback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
	countRecords (criteria, endCallback) {
		let execute = (executeCallback) => {
			let db, collection, cursor;

			if (this.mongo == null) {
				process.nextTick (() => {
					executeCallback ("Store connection not established", null);
				});
				return;
			}

			db = this.mongo.db (this.dbName);
			collection = db.collection (this.collectionName);
			cursor = collection.find (criteria);
			cursor.count (true, { }, (err, count) => {
				if (err != null) {
					executeCallback (err, null);
					return;
				}

				executeCallback (null, count);
			});
		};

		if (typeof endCallback == "function") {
			execute (endCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err, recordCount) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve (recordCount);
				});
			}));
		}
	}

	// Check if a record matching the specified MongoDB criteria exists. Invokes the provided callback when complete, with "err" and "exists" parameters.
	recordExists (criteria, callback) {
		let db, collection, cursor;

		if (this.mongo == null) {
			process.nextTick (() => {
				callback ("Store connection not established", null);
			});
			return;
		}

		db = this.mongo.db (this.dbName);
		collection = db.collection (this.collectionName);
		cursor = collection.find (criteria);
		cursor.count (true, { limit: 1 }, (err, count) => {
			if (err != null) {
				callback (err, null);
				return;
			}

			callback (null, (count > 0));
		});
	}

	// Search the data store for records using the provided MongoDB criteria, sort specification, and options. Invokes the provided callback when complete, with "err" (non-null if an error occurred) and "records" (array of result objects) parameters. If a callback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
	findAllRecords (criteria, sort, maxResults, skipCount, endCallback) {
		let execute = (executeCallback) => {
			let records, findCallback;

			records = [ ];
			findCallback = (err, record) => {
				if (err != null) {
					executeCallback (err, null);
					return;
				}

				if (record == null) {
					executeCallback (null, records);
					return;
				}

				records.push (record);
			};

			this.findRecords (findCallback, criteria, sort, maxResults, skipCount);
		};

		if (typeof endCallback == "function") {
			execute (endCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err, records) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve (records);
				});
			}));
		}
	}

	// Search the data store for records using the provided MongoDB criteria, sort specification, and options. Invokes the provided callback on each record found, with "err" and "record" parameters. err is non-null if an error was encountered, while record is null if the end of the list was reached. sort can be null if not needed, causing results to be generated in unspecified order.
	findRecords (findCallback, criteria, sort, maxResults, skipCount) {
		let db, options, collection, cursor;

		if (this.mongo == null) {
			process.nextTick (() => {
				findCallback ("Store connection not established", null);
			});
			return;
		}

		db = this.mongo.db (this.dbName);
		collection = db.collection (this.collectionName);
		options = { };
		if ((typeof sort == "object") && (sort != null)) {
			options.sort = sort;
		}
		if (typeof maxResults == "number") {
			options.limit = maxResults;
		}
		if (typeof skipCount == "number") {
			options.skip = skipCount;
		}

		cursor = collection.find (criteria, options);
		cursor.hasNext (hasNextComplete);

		function hasNextComplete (err, result) {
			if (err != null) {
				findCallback (err, null);
				return;
			}

			if (result !== true) {
				findCallback (null, null);
				return;
			}

			process.nextTick (() => {
				cursor.next (nextComplete);
			});
		}

		function nextComplete (err, result) {
			if (err != null) {
				findCallback (err, null);
				return;
			}

			// Records are stripped of the MongoDB _id field before being returned
			delete (result["_id"]);

			process.nextTick (() => {
				findCallback (null, result);
				cursor.hasNext (hasNextComplete);
			});
		}
	}

	// Remove records matching the provided MongoDB criteria. Invokes the provided callback when complete, with an "err" parameter.
	removeRecords (criteria, callback) {
		let db, collection;

		if (this.mongo == null) {
			process.nextTick (() => {
				callback ("Store connection not established", null);
			});
			return;
		}

		db = this.mongo.db (this.dbName);
		collection = db.collection (this.collectionName);
		collection.remove (criteria, callback);
	}

	// Create an index for the collection and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred)
	createIndex (keys, options, callback) {
		let db, collection;

		if (this.mongo == null) {
			process.nextTick (() => {
				callback ("Store connection not established", null);
			});
			return;
		}

		db = this.mongo.db (this.dbName);
		collection = db.collection (this.collectionName);
		collection.createIndex (keys, options, createIndexComplete);
		function createIndexComplete (err) {
			callback (err);
		}
	}

	// Return a string value representing the provided search key, suitable for use as a $regex key in a selection criteria object
	getSearchKeyRegex (searchKey) {
		let key;

		key = searchKey;
		key = key.trim ();
		key = key.replace (/[^0-9a-zA-Z\* ]/g, '');
		key = key.replace (/\*/g, '.*');

		return (key);
	}
}

module.exports = DataStore;
