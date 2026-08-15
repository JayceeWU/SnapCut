import {
  DEFAULT_PROJECT_NAME,
  MAX_EXPORT_BASENAME_CODE_POINTS,
  MAX_PROJECT_NAME_CODE_POINTS,
} from './constants';
import { DomainError } from './errors';
import { unicodeCodePointLength } from '../utils/unicode';

const PATH_OR_CONTROL_CHARACTER = /[\u0000-\u001f\u007f/\\:*?"<>|]/u;
const PATH_OR_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f/\\:*?"<>|]/gu;
const MANAGED_EXPORT_EXTENSION = /\.(?:m4a|flac|mp3)$/iu;

export function isValidProjectName(value: string): boolean {
  return (
    value === value.trim() &&
    unicodeCodePointLength(value) >= 1 &&
    unicodeCodePointLength(value) <= MAX_PROJECT_NAME_CODE_POINTS &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

/**
 * Normalizes user input for project creation. Blank input gets the documented
 * default; explicit non-blank values must fit the persisted name contract.
 */
export function normalizeProjectName(value?: string | null): string {
  const normalized = value?.trim() ?? '';
  const projectName = normalized.length === 0 ? DEFAULT_PROJECT_NAME : normalized;

  if (!isValidProjectName(projectName)) {
    throw new DomainError(
      'INVALID_PROJECT_NAME',
      `Project name must contain 1 to ${MAX_PROJECT_NAME_CODE_POINTS} Unicode characters`,
    );
  }

  return projectName;
}

export function validateExportBaseName(value: string): string {
  const normalized = value.trim();
  const length = unicodeCodePointLength(normalized);

  if (
    normalized !== value ||
    length < 1 ||
    length > MAX_EXPORT_BASENAME_CODE_POINTS ||
    PATH_OR_CONTROL_CHARACTER.test(normalized) ||
    MANAGED_EXPORT_EXTENSION.test(normalized) ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new DomainError(
      'INVALID_EXPORT_NAME',
      `Export name must contain 1 to ${MAX_EXPORT_BASENAME_CODE_POINTS} safe characters without an extension`,
    );
  }

  return normalized;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function createDefaultProjectName(at: Date): string {
  if (Number.isNaN(at.getTime())) {
    throw new DomainError('INVALID_PROJECT_NAME', 'Project date must be valid');
  }

  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}-${pad2(at.getMinutes())}-${pad2(at.getSeconds())}`;
}

export function createDefaultExportBaseName(projectName: string, at: Date): string {
  const trimmedProjectName = projectName.trim();
  const projectBaseName =
    trimmedProjectName.length > 0 ? trimmedProjectName : createDefaultProjectName(at);
  const withoutManagedExtension = projectBaseName.replace(
    MANAGED_EXPORT_EXTENSION,
    (extension) => `-${extension.slice(1)}`,
  );
  const safeBaseName = Array.from(withoutManagedExtension.replace(PATH_OR_CONTROL_CHARACTERS, '-'))
    .slice(0, MAX_EXPORT_BASENAME_CODE_POINTS)
    .join('')
    .trim()
    .replace(/^\.{1,2}$/u, '-');

  return validateExportBaseName(safeBaseName);
}
