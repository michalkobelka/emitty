'use strict';

import * as path from 'path';
import * as fs from 'fs';

import * as readdir from 'readdir-enhanced';
import * as micromatch from 'micromatch';

import { ILanguage } from './config';
import { Storage, IStorageItem } from './storage';
import { parseDependencies } from '../parser/dependencies';
import { IOptions } from '../emitty';
import { relative, join } from '../utils/paths';
import { pathExists, statFile, readFile } from '../utils/fs';

export interface IFile {
	filepath: string;
	ctime: number;
}

export class Scanner {

	private changedFile: string;
	private excludePatterns: string[] = [];

	constructor(private root: string, private storage: Storage, private language: ILanguage, private options: IOptions) {
		this.excludePatterns = this.options.scanner.exclude;
	}

	public scan(filepath?: string, stats?: fs.Stats): Promise<any> {
		if (filepath && this.storage.keys().length !== 0) {
			return this.scanFile(filepath, stats);
		}

		return this.scanDirectory();
	}

	private scanFile(filepath: string, stats: fs.Stats): Promise<any> {
		let statPromise: Promise<fs.Stats>;
		if (stats) {
			statPromise = pathExists(filepath).then((exists) => {
				if (exists) {
					return Promise.resolve(stats);
				}
			});
		} else {
			statPromise = statFile(filepath);
		}

		return statPromise.then((stat) => {
			const entry = this.makeEntryFile(filepath, stat.ctime);
			return this.makeDependenciesForDocument(entry);
		});
	}

	/**
	 * Scans directory and saves the dependencies for each file in the Storage.
	 */
	private scanDirectory(): Promise<string> {
		const listOfPromises = [];

		// Drop previous changed file
		this.changedFile = null;

		return new Promise((resolve) => {
			const stream = readdir.readdirStreamStat(this.root, {
				basePath: path.resolve(this.root),
				filter: (stat) => this.scannerFilter(stat),
				deep: this.options.scanner.depth
			});

			stream.on('data', () => {
				// Because Stream
			});

			stream.on('file', (stat: readdir.IEntry) => {
				const entry = this.makeEntryFile(stat.path, stat.ctime);

				// Return Cache if it exists and not outdated
				const entryFilePath = relative(process.cwd(), entry.filepath);
				const cached = this.storage.get(entryFilePath);
				if (cached && cached.ctime >= entry.ctime) {
					listOfPromises.push(cached);
					return;
				}

				this.changedFile = entryFilePath;
				listOfPromises.push(this.makeDependenciesForDocument(entry));
			});

			stream.on('end', () => {
				Promise.all(listOfPromises).then(() => {
					resolve(this.changedFile);
				});
			});
		});
	}

	private makeDependenciesForDocument(entry: IFile): Promise<any> {
		// Remove base path
		const entryFilePath = relative(process.cwd(), entry.filepath);
		const entryDir = path.dirname(entryFilePath);

		return readFile(entry.filepath).then((data) => {
			const item = <IStorageItem>{
				dependencies: parseDependencies(data, this.language),
				ctime: entry.ctime
			};

			// Calculating the path relative to the root directory
			item.dependencies = item.dependencies.map((filepath) => {
				if (!path.extname(filepath)) {
					filepath = filepath + this.language.extensions[0];
				}
				return join(entryDir, filepath);
			});

			this.storage.set(entryFilePath, item);
		});
	}

	private makeEntryFile(filepath: string, ctime: Date): IFile {
		return {
			filepath,
			ctime: ctime.getTime()
		};
	}

	private scannerFilter(stat: readdir.IEntry) {
		if (this.excludePatterns && micromatch(stat.path, this.excludePatterns).length !== 0) {
			return false;
		} else if (stat.isFile()) {
			return this.language.extensions.indexOf(path.extname(stat.path)) !== -1;
		}
		return true;
	}

}
