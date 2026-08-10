export const BUSINESS_MIGRATION_FORMAT: "taobao-business-migration";
export const BUSINESS_MIGRATION_VERSION: 2;
export const BUSINESS_MIGRATION_KDF_ITERATIONS: number;
export const BUSINESS_MIGRATION_MAX_PASSPHRASE_LENGTH: number;
export const BUSINESS_MIGRATION_MAX_RECORD_BYTES: number;
export const BUSINESS_MIGRATION_MAX_LINE_BYTES: number;
export const BUSINESS_MIGRATION_CATALOG_ALGORITHM: "SHA-256-CHAIN-V1";
export const BUSINESS_MIGRATION_CATALOG_SEED: string;

export type MigrationHeader = {
  type: "header";
  format: typeof BUSINESS_MIGRATION_FORMAT;
  version: typeof BUSINESS_MIGRATION_VERSION;
  createdAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; keyLength: 256; recordAad: string };
};

export type MigrationRecordSummary = {
  index: number;
  kind: "vault" | "directory" | "run" | "manifest";
  name: string;
  bytes: number;
  sha256: string;
};

export function validateMigrationPassphrase(value: unknown): string;
export function createMigrationHeader(createdAt?: Date): MigrationHeader;
export function validateMigrationHeader(value: unknown): MigrationHeader;
export function deriveMigrationKey(passphrase: string, header: MigrationHeader): Promise<CryptoKey>;
export function sha256HexBytes(bytes: Uint8Array): Promise<string>;
export function sha256HexText(value: string): Promise<string>;
export function encryptMigrationRecord(
  key: CryptoKey,
  header: MigrationHeader,
  descriptor: { index: number; kind: MigrationRecordSummary["kind"]; name: string },
  value: unknown,
): Promise<{ envelope: Record<string, unknown>; summary: MigrationRecordSummary }>;
export function decryptMigrationRecord(
  key: CryptoKey,
  header: MigrationHeader,
  envelope: unknown,
): Promise<{ descriptor: Record<string, unknown>; value: unknown; summary: MigrationRecordSummary }>;
export function encodeMigrationLine(value: unknown): string;
export function parseMigrationLine(value: string, lineNumber?: number): unknown;
export function appendMigrationCatalogHash(
  previousHash: string,
  summary: MigrationRecordSummary,
): Promise<string>;
