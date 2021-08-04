/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
/* eslint-disable no-console */

import * as path from 'path';
import * as fs from 'fs';
import { AsyncCreatable } from '@salesforce/kit';
import { NamedPackageDir, fs as fsCore, Logger } from '@salesforce/core';
import * as git from 'isomorphic-git';

/**
 * returns the full path to where we store the shadow repo
 */
const getGitDir = (orgId: string, projectPath: string): string => {
  return path.join(projectPath, '.sfdx', 'orgs', orgId);
};

const toFilenames = (rows: StatusRow[]): string[] => rows.map((file) => file[FILE] as string);

interface ShadowRepoOptions {
  orgId: string;
  projectPath: string;
  packageDirs: NamedPackageDir[];
}

type StatusRow = Array<string | number>;

// array members for status results
// https://isomorphic-git.org/docs/en/statusMatrix#docsNav
const FILE = 0;
const HEAD = 1;
const WORKDIR = 2;

interface CommitRequest {
  deployedFiles?: string[];
  deletedFiles?: string[];
  message?: string;
}

export class ShadowRepo extends AsyncCreatable<ShadowRepoOptions> {
  // next 5 props get set in init() from asyncCreatable
  public gitDir: string;
  public projectPath: string;
  private packageDirs!: NamedPackageDir[];
  private status!: StatusRow[];
  private logger!: Logger;

  private options: ShadowRepoOptions;

  public constructor(options: ShadowRepoOptions) {
    super(options);
    this.options = options;
    this.gitDir = getGitDir(options.orgId, options.projectPath);
    this.projectPath = options.projectPath;
    this.packageDirs = options.packageDirs;
  }

  public async init(): Promise<void> {
    this.logger = await Logger.child('ShadowRepo');
    this.logger.debug('options for constructor are', this.options);
    // initialize the shadow repo if it doesn't exist
    if (!fs.existsSync(this.gitDir)) {
      this.logger.debug('initializing git repo');
      await this.gitInit();
    }
  }

  /**
   * Initialize a new source tracking shadow repo.  Think of git init
   *
   */
  public async gitInit(): Promise<void> {
    await fsCore.mkdirp(this.gitDir);
    await git.init({ fs, dir: this.projectPath, gitdir: this.gitDir, defaultBranch: 'main' });
  }

  /**
   * If the status already exists, return it.  Otherwise, set the status before returning.
   * It's kinda like a cache
   *
   * @params noCache: if true, force a redo of the status using FS even if it exists
   *
   * @returns StatusRow[]
   */
  public async getStatus(noCache = false): Promise<StatusRow[]> {
    if (!this.status || noCache) {
      await this.stashIgnoreFile();
      // status hasn't been initalized yet
      this.status = await git.statusMatrix({
        fs,
        dir: this.projectPath,
        gitdir: this.gitDir,
        filepaths: this.packageDirs.map((dir) => dir.path),
      });
      await this.unStashIgnoreFile();
    }
    return this.status;
  }

  public async getChangedRows(): Promise<StatusRow[]> {
    return (await this.getStatus()).filter((file) => file[HEAD] !== file[WORKDIR]);
  }

  public async getChangedFilenames(): Promise<string[]> {
    return toFilenames(await this.getChangedRows());
  }

  public async getDeletes(): Promise<StatusRow[]> {
    return (await this.getStatus()).filter((file) => file[WORKDIR] === 0);
  }

  public async getDeleteFilenames(): Promise<string[]> {
    return toFilenames(await this.getDeletes());
  }

  public async getNonDeletes(): Promise<StatusRow[]> {
    return (await this.getStatus()).filter((file) => file[WORKDIR] === 2);
  }

  public async getNonDeleteFilenames(): Promise<string[]> {
    return toFilenames(await this.getNonDeletes());
  }

  /**
   * Look through status and stage all changes, then commit
   *
   * @param fileList list of files to commit (full paths)
   * @param message: commit message (include org username and id)
   *
   * @returns sha (string)
   */
  public async commitChanges({
    deployedFiles = [],
    deletedFiles = [],
    message = 'sfdx source tracking',
  }: CommitRequest = {}): Promise<string> {
    // if no files are specified, commit all changes
    if (deployedFiles.length === 0 && deletedFiles.length === 0) {
      deployedFiles = await this.getNonDeleteFilenames();
      deletedFiles = await this.getDeleteFilenames();
    }

    this.logger.debug('changes are', deployedFiles);
    this.logger.debug('deletes are', deletedFiles);

    await this.stashIgnoreFile();

    try {
      // stage changes
      await Promise.all([
        ...deployedFiles.map((filepath) => git.add({ fs, dir: this.projectPath, gitdir: this.gitDir, filepath })),
        ...deletedFiles.map((filepath) => git.remove({ fs, dir: this.projectPath, gitdir: this.gitDir, filepath })),
      ]);

      const sha = await git.commit({
        fs,
        dir: this.projectPath,
        gitdir: this.gitDir,
        message,
        author: { name: 'sfdx source tracking' },
      });
      return sha;
    } finally {
      await this.unStashIgnoreFile();
    }
  }

  private async stashIgnoreFile(): Promise<void> {
    await fs.promises.rename(path.join(this.projectPath, '.gitignore'), path.join(this.projectPath, '.BAK.gitignore'));
  }

  private async unStashIgnoreFile(): Promise<void> {
    await fs.promises.rename(path.join(this.projectPath, '.BAK.gitignore'), path.join(this.projectPath, '.gitignore'));
  }
}