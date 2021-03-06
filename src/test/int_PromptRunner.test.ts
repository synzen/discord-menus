import { Prompt, VisualGenerator, PromptFunction } from "../Prompt"
import { PromptRunner } from '../PromptRunner'
import { EventEmitter } from "events"
import { Rejection } from "../errors/Rejection";
import { PromptNode, PromptNodeCondition } from "../PromptNode";
import { MessageInterface } from "../interfaces/Message";
import { UserVoluntaryExitError } from "../errors/user/UserVoluntaryExitError";
import { UserInactivityError } from "../errors/user/UserInactivityError";

async function flushPromises(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

type MockChannel = {
  send: jest.Mock;
}

type MockMessage = {
  content: string;
}

const createMockChannel = (): MockChannel => ({
  send: jest.fn(() => Promise.resolve())
})

const createMockMessage = (content = ''): MockMessage => ({
  content
})

const promptForm: VisualGenerator<{}> = async () => ({
  text: '1',
  embed: {
    title: '1'
  }
})
const promptFunc: PromptFunction<{}, MessageInterface> = async () => ({})

class MyPrompt<DataType> extends Prompt<DataType, MessageInterface> {
  onReject(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  createCollector (): EventEmitter {
    return new EventEmitter()
  }
}

describe('Int::PromptRunner', () => {
  let emitter = new EventEmitter()
  beforeEach(() => {
    emitter = new EventEmitter()
    jest.spyOn(MyPrompt.prototype, 'createCollector')
      .mockReturnValue(emitter)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })
  describe('validate', () => {
    it('returns true for <= 1 children with no conditions', () => {
      const promptR = new MyPrompt(promptForm, promptFunc)
      const promptR1 = new MyPrompt(promptForm, promptFunc)
      const promptR11 = new MyPrompt(promptForm, promptFunc)
      const nodeR = new PromptNode(promptR)
      const nodeR1 = new PromptNode(promptR1)
      const nodeR11 = new PromptNode(promptR11)
      nodeR.children = [nodeR1]
      nodeR1.children = [nodeR11]
      nodeR11.children = []
      expect(PromptRunner.valid(nodeR)).toEqual(true)
    })
    it('returns false for > 1 children with some having no conditions', () => {
      const promptR = new MyPrompt(promptForm, promptFunc)
      const promptR1 = new MyPrompt(promptForm, promptFunc)
      const promptR11 = new MyPrompt(promptForm, promptFunc)
      const promptR12 = new MyPrompt(promptForm, promptFunc)
      const nodeR = new PromptNode(promptR)
      const nodeR1 = new PromptNode(promptR1)
      const nodeR11 = new PromptNode(promptR11)
      const nodeR12 = new PromptNode(promptR12)
      nodeR.children = [nodeR1]
      nodeR1.children = [nodeR11, nodeR12]
      nodeR11.children = []
      nodeR12.children = []
      expect(PromptRunner.valid(nodeR)).toEqual(false)
    })
    it('returns true for > 1 children all having conditions', () => {
      const promptR = new MyPrompt(promptForm, promptFunc)
      const promptR1 = new MyPrompt(promptForm, promptFunc)
      const promptR11 = new MyPrompt(promptForm, promptFunc)
      const promptR12 = new MyPrompt(promptForm, promptFunc)
      const promptR121 = new MyPrompt(promptForm, promptFunc)
      const promptR122 = new MyPrompt(promptForm, promptFunc)
      const nodeR = new PromptNode(promptR)
      const nodeR1 = new PromptNode(promptR1)
      const nodeR11 = new PromptNode(promptR11, async () => false)
      const nodeR12 = new PromptNode(promptR12, async () => true)
      const nodeR121 = new PromptNode(promptR121, async () => true)
      const nodeR122 = new PromptNode(promptR122, async () => true)
      nodeR.children = [nodeR1]
      nodeR1.children = [nodeR11, nodeR12]
      nodeR11.children = []
      nodeR12.children = [nodeR121, nodeR122]
      nodeR121.children = []
      nodeR122.children = []
      expect(PromptRunner.valid(nodeR)).toEqual(true)
    })
  })
  describe('execute', () => {
    it('runs the right prompts (ignoring collect)', async () => {
      const channel = createMockChannel()
      const promptR = new MyPrompt(promptForm, promptFunc)
      const promptRC1 = new MyPrompt(promptForm, promptFunc)
      const promptRC2 = new MyPrompt(promptForm, promptFunc)
      const promptRC11 = new MyPrompt(promptForm, promptFunc)
      const promptRC111 = new MyPrompt(promptForm)
      const promptRC112 = new MyPrompt(promptForm)
      const nodeR = new PromptNode(promptR)
      const nodeRC1 = new PromptNode(promptRC1, async () => false)
      const nodeRC2 = new PromptNode(promptRC2, async () => true)
      const nodeRC11 = new PromptNode(promptRC11)
      const nodeRC111 = new PromptNode(promptRC111, async () => true)
      const nodeRC112 = new PromptNode(promptRC112, async () => false)
      const prompts = [promptR, promptRC1, promptRC2, promptRC11, promptRC111, promptRC112]
      const spies = prompts.map(p => {
        return jest.spyOn(p, 'collect').mockResolvedValue({
          data: {},
          terminate: false
        })
      })

      nodeR.children = [nodeRC1, nodeRC2]
      nodeRC2.children = [nodeRC11]
      // Either of these should not collect since they have no children
      nodeRC11.children = [nodeRC111, nodeRC112]
      const runner = new PromptRunner<{}, MessageInterface>({})
      await runner.execute(nodeR, channel)
      expect(spies[0]).toHaveBeenCalledTimes(1)
      expect(spies[1]).not.toHaveBeenCalled()
      expect(spies[2]).toHaveBeenCalledTimes(1)
      expect(spies[3]).toHaveBeenCalledTimes(1)
      expect(spies[4]).toHaveBeenCalledTimes(1)
      expect(spies[5]).not.toHaveBeenCalled()
      expect(runner.indexesOf(prompts)).toEqual([
        0, -1, 1, 2, 3, -1
      ])
    })
    it('runs collect for regular Prompt even if no children', async () => {
      const channel = createMockChannel()
      const prompt = new MyPrompt(promptForm, promptFunc)
      const node = new PromptNode(prompt)
      const spy = jest.spyOn(prompt, 'collect').mockResolvedValue({
        data: {},
        terminate: false
      })
      const runner = new PromptRunner<{}, MessageInterface>({})
      await runner.execute(node, channel)
      expect(spy).toHaveBeenCalledTimes(1)
    })
    it('does not run collect for prompt with no function', async () => {
      const channel = createMockChannel()
      const prompt = new MyPrompt(promptForm)
      const node = new PromptNode(prompt)
      const spy = jest.spyOn(prompt, 'createCollector')
      const runner = new PromptRunner<{}, MessageInterface>({})
      await runner.execute(node, channel)
      expect(spy).not.toHaveBeenCalled()
    })
  })
  describe('runArray', () => {
    it('works with the first matching node', async () => {
      const channel = createMockChannel()
      // Prompts
      const prompt1 = new MyPrompt(promptForm, promptFunc)
      const prompt2 = new MyPrompt(promptForm, promptFunc)
      const prompt3 = new MyPrompt(promptForm, promptFunc)
      const prompt4 = new MyPrompt(promptForm, promptFunc)
      const prompt5 = new MyPrompt(promptForm, promptFunc)
      // Nodes
      const node1 = new PromptNode(prompt1, async () => false)
      const node2 = new PromptNode(prompt2, async () => true)
      const node3 = new PromptNode(prompt3, async () => true)
      const node4 = new PromptNode(prompt4, async () => false)
      const node5 = new PromptNode(prompt5, async () => true)
      // Set node children
      const entry = [node1, node2]
      node2.children = [node3]
      node3.children = [node4, node5]
      node4.children = []
      node5.children = []

      const runner = new PromptRunner<{}, MessageInterface>({})
      const promise = runner.runArray(entry, channel)
      await flushPromises()
      emitter.emit('message', createMockMessage())
      await flushPromises()
      expect(runner.indexOf(prompt1)).toEqual(-1)
      expect(runner.indexOf(prompt2)).toEqual(0)
      emitter.emit('message', createMockMessage())
      await flushPromises()
      expect(runner.indexOf(prompt3)).toEqual(1)
      emitter.emit('message', createMockMessage())
      await flushPromises()
      await promise
      expect(runner.indexOf(prompt4)).toEqual(-1)
      expect(runner.indexOf(prompt5)).toEqual(2)
    })
  })
  describe('run', () => {
    it('works with prompt collect and getNext', async () => {
      const channel = createMockChannel()
      // Prompts
      const prompt = new MyPrompt(promptForm, promptFunc)
      const promptC1 = new MyPrompt(promptForm, promptFunc)
      const promptC2 = new MyPrompt(promptForm, promptFunc)
      const promptC21 = new MyPrompt(promptForm)
      // Nodes
      const node = new PromptNode(prompt)
      const nodeC1 = new PromptNode(promptC1, async () => false)
      const nodeC2 = new PromptNode(promptC2, async () => true)
      const nodeC21 = new PromptNode(promptC21)
      node.children = [nodeC1, nodeC2]
      nodeC2.children = [nodeC21]
      nodeC21.children = []

      const runner = new PromptRunner<{}, MessageInterface>({})
      const promise = runner.run(node, channel)
      await flushPromises()
      emitter.emit('message', createMockMessage())
      await flushPromises()
      expect(runner.indexOf(prompt)).toEqual(0)
      await flushPromises()
      emitter.emit('message', createMockMessage())
      await flushPromises()
      expect(runner.indexOf(promptC1)).toEqual(-1)
      expect(runner.indexOf(promptC2)).toEqual(1)
      await promise
      expect(runner.indexOf(promptC21)).toEqual(2)
    })
    it('works with custom functions', async () => {
      type PromptData = {
        age?: number;
        name?: string;
      }
      const thisPromptForm: VisualGenerator<PromptData> = async () => ({
        text: '1',
        embed: {
          title: '1'
        }
      })
      const askNameFn: PromptFunction<PromptData, MessageInterface> = async (m, data) => {
        if (!data) {
          throw new Error('Missing data')
        }
        data.name = m.content
        return data
      }
      
      // Ask age prompt that collects messages
      const askAgeFn: PromptFunction<PromptData, MessageInterface> = async (m, data) => {
        if (!data) {
          throw new Error('Missing data')
        }
        if (isNaN(Number(m.content))) {
          // Send a rejection message and continue collecting
          throw new Rejection()
        }
        data.age = Number(m.content)
        return data
      }
      const tooOldCondition: PromptNodeCondition<PromptData> = async (data) => {
        return !!(data.age && data.age >= 20)
      }
      const tooYoungCondition: PromptNodeCondition<PromptData> = async (data) => {
        return !!(data.age && data.age < 20)
      }

      const askName = new MyPrompt<PromptData>(thisPromptForm, askNameFn)
      const askAge = new MyPrompt<PromptData>(thisPromptForm, askAgeFn)
      const tooOld = new MyPrompt<PromptData>(thisPromptForm)
      const tooYoung = new MyPrompt<PromptData>(thisPromptForm)
      const askNameNode = new PromptNode(askName)
      const askAgeNode = new PromptNode(askAge)
      const tooOldNode = new PromptNode(tooOld, tooOldCondition)
      const tooYoungNode = new PromptNode(tooYoung, tooYoungCondition)
      askNameNode.setChildren([askAgeNode])
      askAgeNode.setChildren([tooOldNode, tooYoungNode])
      
      const channel = createMockChannel()
      const name = 'George'
      const age = '30'
      
      const runner = new PromptRunner<PromptData, MessageInterface>({})
      const promise = runner.run(askNameNode, channel)
      // Wait for all pending promise callbacks to be executed for the emitter to set up
      await flushPromises()
      // Accept the name
      emitter.emit('message', createMockMessage(name))
      await flushPromises()
      expect(runner.indexOf(askName)).toEqual(0)
      // Wait for all pending promise callbacks to be executed for message to be accepted
      await flushPromises()
      // Accept the age
      emitter.emit('message', createMockMessage(age))
      await flushPromises()
      expect(runner.indexOf(askAge)).toEqual(1)
      await promise
      expect(runner.indexesOf([tooOld, tooYoung]))
        .toEqual([2, -1])
    })
    it('calls all functions', async () => {
      type PromptData = {
        age?: number;
        name?: string;
      }
      const thisPromptForm: VisualGenerator<PromptData> = async () => ({
        text: '1',
        embed: {
          title: '1'
        }
      })
      const askNameFnSpy = jest.fn()
      const askNameFn: PromptFunction<PromptData, MessageInterface> = async (m, data) => {
        askNameFnSpy()
        if (!data) {
          throw new Error('Missing data')
        }
        data.name = m.content
        return data
      }
      const askName = new MyPrompt<PromptData>(thisPromptForm, askNameFn)
      
      // Ask age prompt that collects messages
      const askAgeFnSpy = jest.fn()
      const askAgeFn: PromptFunction<PromptData, MessageInterface> = async (m, data) => {
        askAgeFnSpy()
        if (!data) {
          throw new Error('Missing data')
        }
        if (isNaN(Number(m.content))) {
          // Send a rejection message and continue collecting
          throw new Rejection()
        }
        data.age = Number(m.content)
        return data
      }
      const tooOldFnSpy = jest.fn()
      const tooOldCondition: PromptNodeCondition<PromptData> = async (data) => {
        tooOldFnSpy()
        return !!(data.age && data.age >= 20)
      }
      const tooYoungFnSpy = jest.fn()
      const tooYoungCondition: PromptNodeCondition<PromptData> = async (data) => {
        tooYoungFnSpy()
        return !!(data.age && data.age < 20)
      }
      const askAge = new MyPrompt<PromptData>(thisPromptForm, askAgeFn)
      const tooOld = new MyPrompt<PromptData>(thisPromptForm)
      const tooYoung = new MyPrompt<PromptData>(thisPromptForm)
      const askNameNode = new PromptNode(askName)
      const askAgeNode = new PromptNode(askAge)
      const tooOldNode = new PromptNode(tooOld, tooOldCondition)
      const tooYoungNode = new PromptNode(tooYoung, tooYoungCondition)
      askNameNode.setChildren([askAgeNode])
      askAgeNode.setChildren([tooOldNode, tooYoungNode])
      
      const channel = createMockChannel()
      const name = 'George'
      const age = '30'
      const runner = new PromptRunner<PromptData, MessageInterface>({})
      const promise = runner.run(askNameNode, channel)
      // Wait for all pending promise callbacks to be executed for the emitter to set up
      await flushPromises()
      // Accept the name
      emitter.emit('message', createMockMessage(name))
      expect(askNameFnSpy).toHaveBeenCalledTimes(1)
      // Wait for all pending promise callbacks to be executed for message to be accepted
      await flushPromises()
      // Accept the age
      emitter.emit('message', createMockMessage(age))
      expect(askAgeFnSpy).toHaveBeenCalledTimes(1)
      await promise
      expect(tooOldFnSpy).toHaveBeenCalledTimes(1)
      expect(tooYoungFnSpy).not.toHaveBeenCalled()
    })
    it('rejects on exit', async () => {
      type PromptData = {
        age?: number;
        name?: string;
      }
      const thisPromptForm: VisualGenerator<PromptData> = async () => ({
        text: '1',
        embed: {
          title: '1'
        }
      })
      const askNameFnSpy = jest.fn()
      const askNameFn: PromptFunction<PromptData, MessageInterface> = async (m, data) => {
        askNameFnSpy()
        if (!data) {
          throw new Error('Missing data')
        }
        data.name = m.content
        return data
      }
      const askName = new MyPrompt<PromptData>(thisPromptForm, askNameFn)
      const askNameNode = new PromptNode(askName)
      const channel = createMockChannel()
      const runner = new PromptRunner<PromptData, MessageInterface>({})
      const promise = runner.run(askNameNode, channel)
      // Wait for all pending promise callbacks to be executed for the emitter to set up
      await flushPromises()
      emitter.emit('exit')
      expect(askNameFnSpy).not.toHaveBeenCalled()
      await expect(promise).rejects.toThrow(UserVoluntaryExitError)
    })
    it('rejects on inactivity', async () => {
      jest.useFakeTimers()
      type PromptData = {
        age?: number;
        name?: string;
      }
      const thisPromptForm: VisualGenerator<PromptData> = async () => ({
        text: '1',
        embed: {
          title: '1'
        }
      })
      const askNameFnSpy = jest.fn()
      const askNameFn: PromptFunction<PromptData, MessageInterface> = async (m, data) => {
        askNameFnSpy()
        if (!data) {
          throw new Error('Missing data')
        }
        data.name = m.content
        return data
      }
      const askName = new MyPrompt<PromptData>(thisPromptForm, askNameFn, 10000)
      const askNameNode = new PromptNode(askName)
      const channel = createMockChannel()
      const runner = new PromptRunner<PromptData, MessageInterface>({})
      const promise = runner.run(askNameNode, channel)
      // Wait for all pending promise callbacks to be executed for the emitter to set up
      await flushPromises()
      jest.runAllTimers()
      await expect(promise).rejects.toThrow(UserInactivityError)
      jest.useRealTimers()
    })
  })
})
