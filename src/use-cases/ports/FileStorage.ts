export interface FileStorage {
    store(bytes: Uint8Array): Promise<string>
}