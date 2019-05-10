import crypto from 'crypto';
import fetch from 'node-fetch';

export class Core {
	static async request(host: string, endpoint: string, data: any): Promise<any> {
		let res;
		try {
			res = await fetch(`https://${host}/api/${endpoint}` , {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(data)
			});
		}
		catch (err) {
			throw new Error('network-error');
		}
		return await res.json();
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
		const app = await Core.request(host, 'app/create', {
			name: name,
			description: description,
			permission: permissions,
			callbackUrl: callbackUrl
		});
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

	constructor(app: App, token: string, url: string) {
		this._app = app;
		this._token = token;
		this._url = url;
	}

	get url(): string {
		return this._url;
	}

	static async generate(app: App): Promise<AuthSession> {
		const authSession = await Core.request(app.host, 'auth/session/generate', {
			appSecret: app.secret
		});
		return new AuthSession(app, authSession.token, authSession.url);
	}

	async getUserToken(): Promise<UserToken | ApiError> {
		const userToken = await Core.request(this._app.host, 'auth/session/userkey', {
			appSecret: this._app.secret,
			token: this._token
		});
		return userToken;
	}

	async waitUntilAuthorized(): Promise<Account> {
		function delay(ms: number): Promise<void> {
			return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
		}

		let userToken;
		for (;;) {
			userToken = await this.getUserToken();
			if (!isApiError(userToken)) {
				return new Account(this._app, userToken.accessToken);
			}
			await delay(1000);
		}
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
		const res = await Core.request(this.app.host, endpoint, {
			i: this._i,
			...data
		});

		return res;
	}
}
