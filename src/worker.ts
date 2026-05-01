// src/worker.ts
// AurisLink Distributed Task Worker
// Offloads resource-intensive operations (search, metadata extraction) to a sub-process.

import { fork, type ChildProcess } from 'node:child_process'
import { log } from './shared/reporter.js'

/**
 * Protocol for communication between the main process and the task worker.
 */
export type TaskRequest =
  | { ticket: string; action: 'query';  provider: string; term: string }
  | { ticket: string; action: 'fetch';  provider: string; link: string }

export type TaskResult =
  | { ticket: string; success: true;  payload: unknown }
  | { ticket: string; success: false; reason: string }

/**
 * Client for interacting with the background task worker.
 */
export class TaskWorkerClient {
  private proc: ChildProcess | null = null
  private activeTasks = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private ticketCounter = 0

  constructor(private readonly scriptPath: string) {}

  /**
   * Spawns the worker process and sets up IPC.
   */
  launch(): void {
    this.proc = fork(this.scriptPath, [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    })

    this.proc.on('message', (msg: TaskResult) => {
      const task = this.activeTasks.get(msg.ticket)
      if (!task) return

      this.activeTasks.delete(msg.ticket)
      if (msg.success) task.resolve(msg.payload)
      else task.reject(new Error(msg.reason))
    })

    this.proc.on('exit', (code) => {
      log('error', 'Worker', `Worker process exited with code ${code}. Restarting...`)
      this.launch()
    })

    log('info', 'Worker', 'Background task worker launched')
  }

  /**
   * Dispatches a task to the worker and returns a promise for the result.
   */
  async execute(request: Omit<TaskRequest, 'ticket'>): Promise<unknown> {
    if (!this.proc) throw new Error('Worker process not initialized')

    const ticket = `T-${++this.ticketCounter}-${Math.random().toString(36).slice(2, 7)}`
    
    return new Promise((resolve, reject) => {
      this.activeTasks.set(ticket, { resolve, reject })
      this.proc!.send({ ...request, ticket })
    })
  }
}
