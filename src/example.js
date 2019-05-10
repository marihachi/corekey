const {
	App,
	AuthSession
} = require('./corekey');

async function entryPoint() {
	const app = await App.create('misskey.io', 'corekey', '', ['write:notes']);
	const session = await AuthSession.generate(app);
	console.log('open in your browser: ', session.url);
	const account = await session.waitUntilAuthorized();
	await account.request('notes/create', {
		text: 'corekey test'
	});
	console.log('posted');
}
entryPoint()
.catch(err => {
	console.log('error: ', err);
});
