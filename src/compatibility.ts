/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as fs from 'fs';
import * as path from 'path';
import { Org, SfdxError, Messages } from '@salesforce/core';

Messages.importMessagesDirectory(__dirname);
const messages: Messages = Messages.loadMessages('@salesforce/source-tracking', 'compatibility');

type TrackingFileVersion = 'plugin-source' | 'toolbelt' | 'none';
/**
 * A project can have "old" (toolbelt), "new" (plugin-source) or "none" tracking files
 *
 * @deprecated use only during transition to new source-tracking commands
 */
export const getTrackingFileVersion = (org: Org, projectPath: string): TrackingFileVersion => {
  const orgsDir = path.join(projectPath, '.sfdx', 'orgs');
  const newFilesDir = path.join(orgsDir, org.getOrgId());
  // has new tracking files based on orgId
  if (fs.existsSync(newFilesDir) && fs.readdirSync(newFilesDir).length > 0) {
    return 'plugin-source';
  }
  const username = org.getUsername();
  if (typeof username === 'string') {
    if (
      // has both of the old files (org:create puts maxRevision.json in the username dir)
      fs.existsSync(path.join(orgsDir, username, 'sourcePathInfos.json')) &&
      fs.existsSync(path.join(orgsDir, username, 'maxRevision.json'))
    ) {
      return 'toolbelt';
    }
  }
  return 'none';
};

/**
 * Convenient wrapper for throwing errors with helpful messages so commands don't have to
 *
 * @deprecated use only during transition to new source-tracking commands
 *
 * @param org: an Org, typically from a command's this.org
 * @param project: the project path, typically from this.project.
 * @param toValidate: whether your command lives in 'toolbelt' or 'plugin-source'
 * @param command: the command itself including all flags.  Echoed with modification for the user
 */
export const throwIfInvalid = ({
  org,
  projectPath,
  toValidate,
  command,
}: {
  org: Org;
  projectPath: string;
  toValidate: Omit<TrackingFileVersion, 'none'>;
  command: string;
}): void => {
  const trackingFileVersion = getTrackingFileVersion(org, projectPath);
  if (trackingFileVersion === 'none' || trackingFileVersion === toValidate) {
    return;
  }

  // We expected it to be the toolbelt version but it is using the new tracking files
  if (toValidate === 'toolbelt') {
    // some of the toolbelt commands aren't using SfdxCommand and the SfdxError actions won't be automatically displayed
    throw new SfdxError(
      `${messages.getMessage('sourceTrackingFileVersionMismatch', ['new/beta'])}\n\nTry this:\n${messages.getMessage(
        'useOtherVersion',
        ['new/beta', replaceRenamedCommands(command.replace(':legacy', ''))]
      )}.\n${messages.getMessage('clearSuggestion', [
        'new/beta',
        replaceRenamedCommands('sfdx force:source:tracking:clear'),
      ])}.`,
      'SourceTrackingFileVersionMismatch'
    );
  }
  // We expected it to be the plugin-source version but it is using the old tracking files
  if (toValidate === 'plugin-source') {
    throw new SfdxError(
      messages.getMessage('sourceTrackingFileVersionMismatch', ['old/legacy']),
      'SourceTrackingFileVersionMismatch',
      [
        messages.getMessage('useOtherVersion', ['old/legacy', replaceRenamedCommands(command, true)]),
        messages.getMessage('clearSuggestion', ['old/legacy', 'sfdx force:source:tracking:clear']),
      ]
    );
  }
};

/**
 * @deprecated use only during transition to new source-tracking commands
 * @param input the string that might contain things that would be replaced
 * @param reverse use the mappings backward
 * @returns string
 */
export const replaceRenamedCommands = (input: string, reverse = false): string => {
  renames.forEach((value, key) => {
    input = reverse ? input.replace(value, key) : input.replace(key, value);
  });
  return input;
};

const renames = new Map([
  ['force:source:status', 'force:source:beta:status'],
  ['force:source:push', 'force:source:beta:push'],
  ['force:source:pull', 'force:source:beta:pull'],
  ['force:source:tracking:reset', 'force:source:beta:tracking:reset'],
  ['force:source:tracking:clear', 'force:source:beta:tracking:clear'],
]);
