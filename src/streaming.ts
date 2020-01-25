import { client as WSClient, connection as WSConnection, IClientConfig } from 'websocket';
import { EventEmitter } from 'events';
import { generateEAID16 } from 'eaid';
import { delay } from './util';

export interface StreamMessage {
	type: string;
	body: Record<string, any>;
}

export interface NoteUpdatedEvent {
	noteId: string;
	body: Record<string, any>;
}

export class Stream {
	isConnected: boolean;
	private _conn: WSConnection;
	private _messenger: EventEmitter;
	messageRecievedEvent: EventEmitter;
	noteUpdatedEvent: EventEmitter;

	constructor(conn: WSConnection) {
		this.isConnected = true;
		this._conn = conn;
		this._messenger = new EventEmitter();
		this.messageRecievedEvent = new EventEmitter();
		this.noteUpdatedEvent = new EventEmitter();

		this._conn.on('error', (err) => {
			console.log('[debug] conn error:', err);
		});
		this._conn.on('close', () => {
			console.log('[debug] closed');
			this.isConnected = false;
			this._messenger.emit('close');
			this._conn.removeAllListeners();
		});
		this._conn.on('message', (frame) => {
			if (frame.type === 'utf8' && frame.utf8Data) {
				try {
					const message: StreamMessage = JSON.parse(frame.utf8Data);
					// console.log('[debug] message:', frame);
					// message.type.startsWith('api:')
					this._messenger.emit('message', message);
					this.messageRecievedEvent.emit(message.type, message.body);
					if (message.type == 'noteUpdated') {
						const event = message.body;
						const noteUpdated: NoteUpdatedEvent = { noteId: event.id, body: event.body };
						this.noteUpdatedEvent.emit(event.type, noteUpdated);
					}
				}
				catch (err) {
					console.log('[debug] JSON parse error:', err);
				}
			}
		});
	}

	static connect(host: string, secure: boolean, token?: string, config?: IClientConfig): Promise<Stream> {
		return new Promise((resolve, reject) => {
			config = config || {};
			const client = new WSClient({...config});
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

	async close(): Promise<void> {
		if (!this.isConnected) throw new Error('stream is already closed');
		this._conn.close();
		while (this.isConnected) {
			await delay(1);
		}
	}

	sendMessage(type: string, body: Record<string, any>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.isConnected) throw new Error('stream is already closed');
			const message: StreamMessage = { type, body };
			const messageJson = JSON.stringify(message);
			this._conn.send(messageJson, (err) => {
				if (err) {
					reject(new Error('send-error'));
					return;
				}
				resolve();
			});
		});
	}

	async connectChannel(channel: string, params?: Record<string, any>): Promise<StreamChannel> {
		if (!this.isConnected) throw new Error('stream is already closed');
		const id = generateEAID16();
		await this.sendMessage('connect', {
			channel: channel,
			id: id,
			params: params
		});
		return new StreamChannel(this, id, this._messenger);
	}

	watchNoteUpdated(noteId: string): Promise<void> {
		return this.sendMessage('subNote', {
			id: noteId
		});
	}

	unwatchNoteUpdated(noteId: string): Promise<void> {
		return this.sendMessage('unsubNote', {
			id: noteId
		});
	}
}

export class StreamChannel {
	private _stream: Stream;
	private _id: string;
	event: EventEmitter;

	constructor(stream: Stream, channelId: string, messenger: EventEmitter) {
		this._stream = stream;
		this._id = channelId;
		this.event = new EventEmitter();
		const messageListener = (message: StreamMessage) => {
			if (message.type != 'channel') return;
			const event = message.body;
			if (event.id != this._id) return;
			this.event.emit(event.type, event.body);
		};
		messenger.on('message', messageListener);
		const closeListener = () => {
			messenger.removeListener('message', messageListener);
			messenger.removeListener('close', closeListener);
		};
		messenger.on('close', closeListener);
	}

	closeChennel(): Promise<void> {
		if (!this._stream.isConnected) throw new Error('stream is already closed');
		return this._stream.sendMessage('disconnect', { id: this._id });
	}
}
