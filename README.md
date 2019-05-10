# corekey
A simply Misskey library for Node.js

## Installation
comming soon

## Usage
### 1. Import the corekey library
You need to import classes you want to use.
```ts
import {
	App,
	AuthSession
} from 'corekey';
```

### 2. Create a Misskey App
You can create an Misskey App in App.create static method.
```ts
const app = await App.create('misskey.io', 'corekey', '', ['write:notes']);
```

### 3. Start a session of the app authorization
Let's get your account instance!
```ts
const session = await AuthSession.generate(app);
console.log('open in your browser: ', session.url);

const account = await session.waitUntilAuthorized();
```

### 4. Access a lot of APIs
For example, Post your notes to the Misskey.
```ts
await account.request('notes/create', {
	text: 'corekey test'
});
```

Enjoy!

## License
MIT
