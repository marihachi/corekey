import { client as WSClient, connection as WSConnection, IClientConfig } from 'websocket';
import { EventEmitter } from 'events';
import { generateEAID12 } from 'eaid';
import { Config } from './lib';
import { delay } from './util';

interface StreamEvents {
	'*': StreamEventFrame;
	noteUpdated: NoteUpdatedEvent;
	channel: ChannelEvent;
}

interface ChannelEvents {
	note: Record<string, any>;
}

interface NoteUpdatedEvents {
	reacted: NoteUpdatedEvent;
	unreacted: NoteUpdatedEvent;
	deleted: NoteUpdatedEvent;
}

interface TypedEventEmitter<T> extends EventEmitter {
	addListener<K extends keyof T>(event: K, listener: (arg: T[K]) => void): this;
	addListener(event: string, listener: (arg: any) => void): this;
	on<K extends keyof T>(event: K, listener: (arg: T[K]) => void): this;
	on(event: string, listener: (arg: any) => void): this;
	once<K extends keyof T>(event: K, listener: (arg: T[K]) => void): this;
	once(event: string, listener: (arg: any) => void): this;
	removeListener<K extends keyof T>(event: K, listener: (arg: T[K]) => void): this;
	removeListener(event: string, listener: (arg: any) => void): this;
	removeAllListeners<K extends keyof T>(event: K): this;
	removeAllListeners(event?: string): this;
	listeners<K extends keyof T>(event: K): Function[];
	listeners(event: string): Function[];
}

export interface StreamEventFrame {
	type: string;
	body: Record<string, any>;
}

export interface NoteUpdatedEvent {
	id: string;
	type: string;
	body: Record<string, any>;
}

export interface ChannelEvent {
	id: string;
	type: string;
	body: Record<string, any>;
}

export class Stream {
	isConnected: boolean;
	private _conn: WSConnection;
	private _messenger: EventEmitter;
	event: TypedEventEmitter<StreamEvents>;
	noteUpdated: NoteUpdatedSubscriber;

	constructor(conn: WSConnection) {
		this.isConnected = true;
		this._conn = conn;
		this._messenger = new EventEmitter();
		this.event = new EventEmitter();
		this.noteUpdated = new NoteUpdatedSubscriber(this, this._messenger);

		this._conn.on('error', (err) => {
			console.log('[debug] conn error:', err);
		});
		this._conn.on('close', () => {
			console.log('[debug] closed');
			this.isConnected = false;
			this._messenger.emit('close');
			this._conn.removeAllListeners();
		});
		this._conn.on('message', (data) => {
			if (data.type === 'utf8' && data.utf8Data) {
				try {
					const frame: StreamEventFrame = JSON.parse(data.utf8Data);
					if (Config.streaming.wildcardEventEnabled) {
						this.event.emit('*', frame);
					}
					this.event.emit(frame.type, frame.body);
					this._messenger.emit('message', frame);
				}
				catch (err) {
					console.log('[debug] JSON parse error:', err);
				}
			}
		});
	}

	static connect(host: string, secure: boolean, token?: string, wsConfig?: IClientConfig): Promise<Stream> {
		return new Promise((resolve, reject) => {
			wsConfig = wsConfig || {};
			const client = new WSClient({...wsConfig});
			client.on('connectFailed', () => {
				client.removeAllListeners();
				reject(new Error('connect-failed'));
			});
			client.on('connect', (conn) => {
				client.removeAllListeners();
				resolve(new Stream(conn));
			});
			const protocol = secure ? 'wss' : 'ws';
			const query = token ? `?i=${token}`: '';
			client.connect(`${protocol}://${host}/streaming${query}`);
		});
	}

	sendEvent(type: string, body: Record<string, any>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.isConnected) throw new Error('stream is already closed');
			const frame: StreamEventFrame = { type, body };
			this._conn.send(JSON.stringify(frame), (err) => {
				if (err) {
					reject(new Error('send-error'));
					return;
				}
				resolve();
			});
		});
	}

	async openChannel(channel: string, params?: Record<string, any>): Promise<StreamChannel> {
		if (!this.isConnected) throw new Error('stream is already closed');
		const id = generateEAID12();
		await this.sendEvent('connect', {
			channel: channel,
			id: id,
			params: params
		});
		return new StreamChannel(this, id, this._messenger);
	}

	async disconnect(): Promise<void> {
		if (!this.isConnected) throw new Error('stream is already closed');
		this._conn.close();
		while (this.isConnected) {
			await delay(1);
		}
	}
}

class StreamChannel {
	private _stream: Stream;
	private _id: string;
	event: TypedEventEmitter<ChannelEvents>;

	constructor(stream: Stream, channelId: string, messenger: EventEmitter) {
		this._stream = stream;
		this._id = channelId;
		this.event = new EventEmitter();
		const messageListener = (frame: StreamEventFrame) => {
			if (frame.type != 'channel' || frame.body.id != this._id) return;
			const event = frame.body;
			this.event.emit(event.type, event.body);
		};
		messenger.on('message', messageListener);
		const closeListener = () => {
			messenger.removeListener('message', messageListener);
			messenger.removeListener('close', closeListener);
		};
		messenger.on('close', closeListener);
	}

	sendEvent(type: string, body: Record<string, any>): Promise<void> {
		return this._stream.sendEvent('channel', {
			id: this._id,
			type: type,
			body: body
		});
	}

	close(): Promise<void> {
		return this._stream.sendEvent('disconnect', {
			id: this._id
		});
	}
}

class NoteUpdatedSubscriber {
	private _stream: Stream;
	event: TypedEventEmitter<NoteUpdatedEvents>;

	constructor(stream: Stream, messenger: EventEmitter) {
		this._stream = stream;
		this.event = new EventEmitter();
		const messageListener = (frame: StreamEventFrame) => {
			if (frame.type != 'noteUpdated') return;
			const event = frame.body;
			this.event.emit(event.type, event);
		};
		messenger.on('message', messageListener);
		const closeListener = () => {
			messenger.removeListener('message', messageListener);
			messenger.removeListener('close', closeListener);
		};
		messenger.on('close', closeListener);
	}

	subscribe(noteId: string): Promise<void> {
		return this._stream.sendEvent('subNote', {
			id: noteId
		});
	}

	unsubscribe(noteId: string): Promise<void> {
		return this._stream.sendEvent('unsubNote', {
			id: noteId
		});
	}
}
