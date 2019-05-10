const crypto = require('crypto');
const fetch = require('node-fetch');

async function request(host, endpoint, data) {
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

function delay(ms) {
	return new Promise(resolve => setTimeout(() => resolve(), ms));
}

function buildHash(text, algorithm) {
	const sha256 = crypto.createHash(algorithm || 'sha256');
	sha256.update(text);

	return sha256.digest('hex');
}

function calcAccessToken(appSecret, userToken) {
	return buildHash(userToken.accessToken + appSecret);
}

class App {
	constructor(host, appSecret) {
		this.host = host;
		this.secret = appSecret;
	}

	static async create(host, name, description, permissions) {
		const app = await request(host, 'app/create', {
			name: name,
			description: description,
			permission: permissions
		});
		return new App(host, app.secret);
	}
}
exports.App = App;

class AuthSession {
	constructor(app, token, url) {
		this._app = app;
		this._token = token;
		this._url = url;
	}

	get url() {
		return this._url;
	}

	static async generate(app) {
		const authSession = await request(app.host, 'auth/session/generate', {
			appSecret: app.secret
		});
		return new AuthSession(app, authSession.token, authSession.url);
	}

	async getUserToken() {
		const userToken = await request(this._app.host, 'auth/session/userkey', {
			appSecret: this._app.secret,
			token: this._token
		});
		return userToken;
	}

	async waitUntilAuthorized() {
		let userToken;
		while (1) {
			userToken = await this.getUserToken();
			if (userToken.error == null) break;
			await delay(1000);
		}
		return new Account(this._app, userToken);
	}
}
exports.AuthSession = AuthSession;

class Account {
	constructor(app, userToken) {
		this.app = app;
		this.userToken = userToken;
		this._i = calcAccessToken(app.secret, userToken);
	}

	async request(endpoint, data) {
		const res = await request(this.app.host, endpoint, {
			i: this._i,
			...data
		});

		return res;
	}
}
exports.Account = Account;
