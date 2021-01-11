import { client as WSClient, connection as WSConnection, IClientConfig, IMessage } from 'websocket';
import ReconnectingWebsocket from 'reconnecting-websocket';
import { EventEmitter } from 'events';
import { Config } from './lib';
import { debugLog, delay } from './util';
import autobind from 'autobind-decorator';

interface Connection {
	connected: boolean;

	close(reasonCode?: number, description?: string): void;
	send(data: any, cb?: (err?: Error) => void): void;

	on(event: 'message', cb: (data: { type: string, utf8Data?: string }) => void): this;
	on(event: 'close', cb: (code: number, desc: string) => void): this;
	on(event: 'error', cb: (err: Error) => void): this;
	addListener(event: 'message', cb: (data: { type: string, utf8Data?: string }) => void): this;
	addListener(event: 'close', cb: (code: number, desc: string) => void): this;
	addListener(event: 'error', cb: (err: Error) => void): this;

	removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
}

/** wildcard event is supported: '*' */
export class Stream extends EventEmitter {
	private internalEvent: EventEmitter;

	private idSource: number = 1;

	public readonly conn: Connection;

	constructor(conn: Connection) {
		super();
		this.conn = conn;
		this.internalEvent = new EventEmitter();
		
		this.conn.addListener('message', this.onMessage);
		this.conn.addListener('error', this.onError);
		this.conn.addListener('close', this.onClose);
	}

	@autobind
	private onMessage(data: IMessage) {
		if (data.type === 'utf8' && data.utf8Data) {
			let frame: Record<string, any> | null = null;
			try {
				frame = JSON.parse(data.utf8Data);
			}
			catch (err) {
				debugLog(err);
			}
			if (frame == null) return;
			if (Config.streaming.wildcardEventEnabled) {
				this.emit('*', frame);
			}
			this.emit(frame.type, frame.body);
			this.internalEvent.emit('message', frame);
		}
	}

	@autobind
	private onError(err: Error) {
		debugLog('ws error');
		debugLog(err);
		this.internalEvent.emit('error', err);
	}

	@autobind
	private onClose() {
		debugLog('ws closed');
		this.conn.removeListener('message', this.onMessage);
		this.conn.removeListener('error', this.onError);
		this.conn.removeListener('close', this.onClose);
		this.internalEvent.emit('close');
	}

	@autobind
	private generateId(): number {
		const id = this.idSource;
		this.idSource++;
		return id;
	}

	@autobind
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
			const path = '/streaming';
			const query = token ? `i=${token}`: '';
			client.connect(`${protocol}://${host}/${path}?${query}`);


			const stream = new ReconnectingWebsocket(`${protocol}://${host}/${path}?${query}`, '', { minReconnectionDelay: 1 });
			
		});
	}

	@autobind
	send(type: string, body: Record<string, any>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.conn.connected) {
				reject(new Error('stream-already-closed'));
				return;
			}
			const frame = { type, body };
			this.conn.send(JSON.stringify(frame), err => {
				if (err) {
					debugLog(err);
					reject(new Error('send-error'));
					return;
				}
				resolve();
			});
		});
	}

	@autobind
	async openChannel(channel: string, params?: Record<string, any>): Promise<StreamChannel> {
		if (!this.conn.connected) {
			throw new Error('stream-already-closed');
		}
		const body: Record<string, any> = {
			channel: channel,
			id: this.generateId()
		};
		if (params != null) body.params = params;
		await this.send('connect', body);
		return new StreamChannel(this, this.internalEvent, body.id);
	}

	@autobind
	async disconnect(): Promise<void> {
		if (!this.conn.connected) throw new Error('stream-already-closed');
		this.conn.close();
		let time = 0;
		while (this.conn.connected) {
			await delay(1);
			time++;
			if (time > 1000) {
				throw new Error('disconnect-timeout');
			}
		}
	}
}

class StreamChannel extends EventEmitter {

	private internalEvent: EventEmitter;

	public readonly stream: Stream;

	public readonly id: string;

	constructor(stream: Stream, internalEvent: EventEmitter, channelId: string) {
		super();
		this.internalEvent = internalEvent;
		this.stream = stream;
		this.id = channelId;
		this.internalEvent.addListener('message', this.onMessage);
		this.internalEvent.addListener('close', this.onClose);
	}

	@autobind
	private onMessage(frame: Record<string, any>) {
		if (frame.type != 'channel') return;
		const event = frame.body;
		if (event.id != this.id) return;
		if (Config.streaming.wildcardEventEnabled) {
			this.emit('*', event);
		}
		this.emit(event.type, event.body);
	}

	@autobind
	private onClose() {
		this.internalEvent.removeListener('message', this.onMessage);
		this.internalEvent.removeListener('close', this.onClose);
	}

	@autobind
	send(type: string, body: Record<string, any>): Promise<void> {
		return this.stream.send('channel', {
			id: this.id,
			type: type,
			body: body
		});
	}

	@autobind
	async close(): Promise<void> {
		await this.stream.send('disconnect', {
			id: this.id
		});
		this.internalEvent.removeListener('message', this.onMessage);
		this.internalEvent.removeListener('close', this.onClose);
	}
}
