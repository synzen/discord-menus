import { Rejection } from './errors/Rejection'
import { TreeNode } from './TreeNode';
import { MessageInterface, ChannelInterface, Format } from './types/discord';
import { EventEmitter } from 'events';

export type PhaseReturnData<T> = {
  message?: MessageInterface;
  data?: T;
}

export type PhaseFunction<T> = (this: Phase<T>, m: MessageInterface, data?: T) => Promise<T>

export interface PhaseCollectorInterface<T> extends EventEmitter {
  emit(event: 'reject', message: MessageInterface, error: Rejection): boolean;
  emit(event: 'accept', message: MessageInterface, data: T): boolean;
  emit(event: 'exit', message: MessageInterface): boolean;
  emit(event: 'inactivity'): boolean;
  emit(event: 'error', message: MessageInterface, error: Error): boolean;
  emit(event: 'message', message: MessageInterface): boolean;
  emit(event: 'stop'): boolean;
  on(event: 'message', listener: (message: MessageInterface) => void): this;
  on(event: 'reject', listener: (message: MessageInterface, error: Rejection) => void): this;
  once(event: 'accept', listener: (message: MessageInterface, data: T) => void): this;
  once(event: 'exit', listener: (message: MessageInterface) => void): this;
  once(event: 'inactivity', listener: () => void): this;
  once(event: 'error', listener: (message: MessageInterface, error: Error) => void): this;
  once(event: 'stop', listener: () => void): this;
}

export type PhaseCollectorCreator<T> = (
  channel: ChannelInterface,
  initialMessage?: MessageInterface
) => PhaseCollectorInterface<T>

export type FormatGenerator<T> = (data?: T) => Format

export type PhaseCondition<T> = (data?: T) => Promise<boolean>;

export abstract class Phase<T> extends TreeNode<Phase<T>> {
  abstract createCollector(channel: ChannelInterface, initialMessage?: MessageInterface): PhaseCollectorInterface<T>;
  formatGenerator: FormatGenerator<T>
  readonly duration: number
  readonly messages: Array<MessageInterface> = []
  readonly function?: PhaseFunction<T>
  readonly condition?: PhaseCondition<T>
  public static STRINGS = {
    exit: `Menu has been closed.`,
    inactivity: 'Menu has been closed due to inactivity.',
    rejected: `That is not a valid input. Try again.`
  }

  constructor(formatGenerator: FormatGenerator<T>, f?: PhaseFunction<T>, condition?: PhaseCondition<T>, duration = 60000) {
    super()
    this.formatGenerator = formatGenerator
    this.duration = duration
    this.function = f
    this.condition = condition
  }

  /**
   * Handles timeout and messages of a message colllector
   * 
   * @param emitter Message collector
   * @param func Phase function
   * @param data Phase data
   * @param duration Duration of collector before it emits inactivity
   */
  static handleCollector<T> (emitter: PhaseCollectorInterface<T>, func: PhaseFunction<T>, data?: T, duration?: number): void {
    let timer: NodeJS.Timeout
    if (duration) {
      timer = setTimeout(() => {
        emitter.emit('stop')
        emitter.emit('inactivity')
      }, duration)
    }
    emitter.on('message', async thisMessage => {
      const stopCollecting = await this.handleMessage(emitter, thisMessage, func, data)
      if (stopCollecting) {
        emitter.emit('stop')
        clearTimeout(timer)
      }
    })
  }

  /**
   * Handle each individual message from a collector to determine
   * what event it should emit. Ignores all messages whose author
   * ID does not match the original message.
   * 
   * @param emitter Message collector
   * @param message Collected message
   * @param func Phase function
   * @param data Phase data
   */
  static async handleMessage<T> (emitter: PhaseCollectorInterface<T>, message: MessageInterface, func: PhaseFunction<T>, data?: T): Promise<boolean> {
    if (message.content === 'exit') {
      emitter.emit('exit', message)
      return true
    }
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      const newData = await func(message, data)
      emitter.emit('accept', message, newData)
      return true
    } catch (err) {
      if (err instanceof Rejection) {
        // Don't stop collector since rejects can be tried again
        emitter.emit('reject', message, err)
        return false
      } else {
        emitter.emit('error', message, err)
        return true
      }
    }
  }

  /**
   * If this Phase should collect messages
   */
  shouldRunCollector (): boolean {
    return true
  }

  /**
   * Send the text and embed for this phase.
   * 
   * @param message The MessageInterface before this phase
   */
  async sendMessage (channel: ChannelInterface, data?: T): Promise<MessageInterface> {
    const format = this.formatGenerator(data)
    const sent = await channel.send(format)
    this.storeMessage(sent)
    return sent
  }

  /**
   * Set all children to empty so there is no next phase.
   * 
   * @param channel The channel to send the terminate message to
   * @param terminateString String to send as a message saying the termination
   */
  async terminateHere (channel: ChannelInterface, terminateString: string): Promise<MessageInterface> {
    this.setChildren([])
    const sent = await channel.send({
      text: terminateString
    })
    this.storeMessage(sent)
    return sent
  }

  /**
   * Determine what the next phase is given a message and data.
   * 
   * @param message The author's message that prompted this phase
   * @param data The data before this phase
   */
  async getNext (data?: T): Promise<Phase<T>|null> {
    const { children } = this
    for (let i = 0; i < children.length; ++i) {
      const child = children[i]
      if (!child.condition || await child.condition(data)) {
        return child
      }
    }
    return null
  }

  /**
   * Store a message into this phase's store
   * 
   * @param message 
   */
  storeMessage (message: MessageInterface): void {
    this.messages.push(message)
  }

  /**
   * Runs the Phase function for every message collected.
   * Reject when channel send promise rejects.
   * 
   * @param channel The channel to collect from
   * @param data The data before this phase
   * @param triggerMessage The message that triggered this collection
   */
  collect (channel: ChannelInterface, data?: T, triggerMessage?: MessageInterface): Promise<PhaseReturnData<T>> {
    return new Promise((resolve, reject) => {
      if (!this.function) {
        resolve({
          data
        })
        return
      }
      const collector: PhaseCollectorInterface<T> = this.createCollector(channel, triggerMessage)
      Phase.handleCollector(collector, this.function.bind(this), data, this.duration)

      const terminate = async (terminateString: string): Promise<void> => {
        const sent = await this.terminateHere(channel, terminateString)
        resolve({
          message: sent,
          data
        })
      }

      collector.once('error', (lastUserInput: MessageInterface, err: Error) => {
        this.storeMessage(lastUserInput)
        reject(err)
      })
      collector.once('inactivity', (): void => {
        terminate(Phase.STRINGS.inactivity)
          .catch(reject)
      })
      collector.once('exit', (exitMessage: MessageInterface) => {
        this.storeMessage(exitMessage)
        terminate(Phase.STRINGS.exit)
          .catch(reject)
      })
      collector.once('accept', (acceptMessage: MessageInterface, acceptData: T): void => {
        this.storeMessage(acceptMessage)
        resolve({
          message: acceptMessage,
          data: acceptData
        })
      })
      collector.on('reject', (userInput: MessageInterface, err: Rejection): void => {
        this.storeMessage(userInput)
        const invalidFeedback = err.message || Phase.STRINGS.rejected
        channel.send({ text: invalidFeedback })
          .then((m) => this.storeMessage(m))
          .catch(reject)
      })
    })
  }
}

