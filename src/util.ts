import { Config } from "./lib";

export function delay(ms: number): Promise<void> {
	return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
}

export function debugLog(err: Error | string) {
	if (Config.debugLogEnabled) {
		console.log('[debug]');
		console.log(err);
	}
}
