import crypto from 'crypto';
import fetch from 'node-fetch';
import FormData from 'form-data';
import $ from 'cafy';

const isReadableStream = (obj: any) => obj != undefined && obj.readable === true && typeof obj.read == 'function';

export interface IRequester {
	request(host: string, endpoint: string, data: {[x: string]: any}, isBinary: boolean): Promise<any>;
}

export class FetchRequester implements IRequester {
	async request(host: string, endpoint: string, data: {[x: string]: any}, isBinary: boolean): Promise<any> {
		let headers, body;

		if (isBinary) {
			const formData = new FormData();
			for (const key of Object.keys(data)) {
				const value = data[key];
				if (isReadableStream(value) || Buffer.isBuffer(value) || $.either($.number, $.string).ok(value)) {
					formData.append(key, value);
				}
				else if ($.boolean.ok(value)) {
					formData.append(key, String(value));
				}
				else {
					throw new Error('invalid-parameter-type');
				}
			}

			headers = formData.getHeaders();
			body = formData;
		}
		else {
			for (const key of Object.keys(data)) {
				const value = data[key];
				if (isReadableStream(value) || Buffer.isBuffer(value)) {
					throw new Error('invalid-parameter-type');
				}
			}
			headers = { 'Content-Type': 'application/json' };
			body = JSON.stringify(data);
		}

		let res;
		try {
			res = await fetch(`https://${host}/api/${endpoint}`, {
				method: 'POST',
				headers: headers,
				body: body
			});
		}
		catch (err) {
			throw new Error('network-error');
		}
		return await res.json();
	}
}

class AuthorizationConfig {
	pollingInterval: number = 1000;
}
class RootConfig {
	requester: IRequester = new FetchRequester();
	authorization: AuthorizationConfig = new AuthorizationConfig();
}
export let Config = new RootConfig();

export class Server {
	static async getVersion(host: string): Promise<string> {
		const response = await Config.requester.request(host, 'version', { }, false);
		return response.version;
	}
}

export class App {
	host: string;
	secret: string;

	constructor(host: string, appSecret: string) {
		this.host = host;
		this.secret = appSecret;
	}

	static async create(host: string, name: string, description: string, permissions: string[], callbackUrl?: string) {
		const app = await Config.requester.request(host, 'app/create', {
			name: name,
			description: description,
			permission: permissions,
			callbackUrl: callbackUrl
		}, false);
		return new App(host, app.secret);
	}
}

type ApiError = { error: any };
function isApiError(obj: {[x: string]: any}): obj is ApiError {
	return obj.error != null;
}
type UserToken = { accessToken: string, user: any };

export class AuthSession {
	private _app: App;
	private _token: string;
	private _url: string;
	private _cancel: boolean;

	constructor(app: App, token: string, url: string) {
		this._app = app;
		this._token = token;
		this._url = url;
		this._cancel = false;
	}

	get url(): string {
		return this._url;
	}

	static async generate(app: App): Promise<AuthSession> {
		const authSession = await Config.requester.request(app.host, 'auth/session/generate', {
			appSecret: app.secret
		}, false);
		return new AuthSession(app, authSession.token, authSession.url);
	}

	async getUserToken(): Promise<UserToken | ApiError> {
		const userToken = await Config.requester.request(this._app.host, 'auth/session/userkey', {
			appSecret: this._app.secret,
			token: this._token
		}, false);
		return userToken;
	}

	async waitForAuth(): Promise<Account> {
		function delay(ms: number): Promise<void> {
			return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
		}

		let userToken;
		for (;;) {
			userToken = await this.getUserToken();
			if (!isApiError(userToken)) {
				return new Account(this._app, userToken.accessToken);
			}
			if (this._cancel) {
				throw new Error('waiting-canceled');
			}
			await delay(Config.authorization.pollingInterval);
		}
	}

	cancelWaiting() {
		this._cancel = true;
	}
}

export class Account {
	app: App;
	userToken: string;
	private _i: string;

	constructor(app: App, userToken: string) {
		function calcAccessToken(appSecret: string, userToken: string): string {
			const sha256 = crypto.createHash('sha256');
			sha256.update(`${userToken}${appSecret}`);
			return sha256.digest('hex');
		}

		this.app = app;
		this.userToken = userToken;
		this._i = calcAccessToken(app.secret, userToken);
	}

	async request(endpoint: string, data: {[x: string]: any}): Promise<any> {
		const res = await Config.requester.request(this.app.host, endpoint, {
			i: this._i,
			...data
		}, false);

		return res;
	}

	async requestBinary(endpoint: string, data: {[x: string]: any}): Promise<any> {
		const res = await Config.requester.request(this.app.host, endpoint, {
			i: this._i,
			...data
		}, true);

		return res;
	}
}
