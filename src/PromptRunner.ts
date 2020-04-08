import { Prompt } from './Prompt'
import { ChannelInterface } from './types/generics'

export class PromptRunner<T> {
  initialData: T
  readonly ran: Array<Prompt<T>> = []
  
  constructor (initialData: T) {
    this.initialData = initialData
  }

  /**
   * Checks whether the tree of prompts is valid. A valid tree
   * is one all children has a condition if there 2 or more
   * children.
   * 
   * @param prompt Root prompt
   */
  static valid<T> (prompt: Prompt<T>): boolean {
    const children = prompt.children
    const multipleChildren = children.length > 1
    for (const child of children) {
      if (multipleChildren && !child.condition) {
        return false
      }
      if (!this.valid(child)) {
        return false
      }
    }
    return true
  }

  /**
   * Returns the index of a prompt that have been executed
   * by this PromptRunner already
   * 
   * @param prompt 
   */
  indexOf (prompt: Prompt<T>): number {
    return this.ran.indexOf(prompt)
  }

  /**
   * Returns the indexes of prompts that have been executed by
   * this PromptRunner already
   * 
   * @param prompts Prompts to check index of
   * @returns {Array<number>} Array of indices
   */
  indexesOf (prompts: Array<Prompt<T>>): Array<number> {
    return prompts.map(prompt => this.indexOf(prompt))
  }

  /**
   * Validate the prompt and all its children before executing
   * 
   * @param prompt Root prompt
   * @param channel Channel
   * @param initialData Data for the root prompt
   * @param triggerMessage Message that triggered this prompt
   */
  async run (prompt: Prompt<T>, channel: ChannelInterface): Promise<void> {
    if (!PromptRunner.valid(prompt)) {
      throw new Error('Invalid prompt found. Prompts with more than 1 child must have all its children to have a condition function specified.')
    }
    return this.execute(prompt, channel)
  }

  /**
   * Execute the prompt without validating
   * 
   * @param prompt Root prompt
   * @param channel Channel
   * @param initialData Data for the root prompt
   */
  async execute (initialPrompt: Prompt<T>, channel: ChannelInterface): Promise<void> {
    this.ran.push(initialPrompt)
    let thisPrompt: Prompt<T>|null = initialPrompt
    let thisData = this.initialData
    await thisPrompt.sendUserFormatMessage(channel, thisData)
    while (thisPrompt && thisPrompt.shouldRunCollector()) {
      const promptData: T = await thisPrompt.collect(channel, thisData)
      thisPrompt = await thisPrompt.getNext(promptData)
      thisData = promptData
      if (thisPrompt) {
        await thisPrompt.sendUserFormatMessage(channel, promptData)
        this.ran.push(thisPrompt)
      }
    }
  }
}