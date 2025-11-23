#!/usr/bin/env node

/**
 * TickTick MCP Server - Genspark Integration Version
 * Базовый код из Vantarc/tick-tick-mcp-server + Genspark adapter
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

// Environment configuration
const TICKTICK_CLIENT_ID = process.env.TICKTICK_CLIENT_ID;
const TICKTICK_CLIENT_SECRET = process.env.TICKTICK_CLIENT_SECRET;
const TICKTICK_TOKEN = process.env.TICKTICK_TOKEN;
const TICKTICK_ACCESS_TOKEN = process.env.TICKTICK_ACCESS_TOKEN || process.env.TICKTICK_API_TOKEN;
const TICKTICK_AUTH_CODE = process.env.TICKTICK_AUTH_CODE;

// Cache configuration
const CACHE_FILE_PATH = path.join(os.homedir(), '.ticktick-mcp-cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

class TickTickMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'ticktick-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.initializeCache();
    this.setupHandlers();
  }

  // Cache management methods
  initializeCache() {
    try {
      if (!fs.existsSync(CACHE_FILE_PATH)) {
        this.saveCache({ tasks: {} });
      }
    } catch (error) {
      console.warn('Failed to initialize cache:', error.message);
    }
  }

  loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE_PATH)) {
        const data = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('Failed to load cache:', error.message);
    }
    return { tasks: {} };
  }

  saveCache(data) {
    try {
      fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn('Failed to save cache:', error.message);
    }
  }

  isTaskStale(task) {
    if (!task.cached_at) return true;
    return Date.now() - new Date(task.cached_at) > CACHE_TTL;
  }

  addTaskToCache(taskId, projectId, title) {
    try {
      const cache = this.loadCache();
      cache.tasks[taskId] = {
        project_id: projectId,
        title: title,
        cached_at: new Date().toISOString()
      };
      this.saveCache(cache);
    } catch (error) {
      console.warn('Failed to add task to cache:', error.message);
    }
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'ticktick_get_projects',
            description: 'Get all projects from TickTick',
            inputSchema: {
              type: 'object',
              properties: {
                include_archived: {
                  type: 'boolean',
                  description: 'Include archived projects',
                  default: false
                }
              }
            }
          },
          {
            name: 'ticktick_create_task',
            description: 'Create a new task in TickTick',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Task title'
                },
                content: {
                  type: 'string',
                  description: 'Task description/content'
                },
                project_id: {
                  type: 'string',
                  description: 'Project ID to add task to'
                },
                priority: {
                  type: 'number',
                  description: 'Task priority (0=None, 1=Low, 3=Medium, 5=High)',
                  default: 0
                },
                due_date: {
                  type: 'string',
                  description: 'Due date in ISO format (YYYY-MM-DDTHH:mm:ss)'
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tags for the task'
                }
              },
              required: ['title']
            }
          },
          {
            name: 'ticktick_get_today_tasks',
            description: 'Get tasks scheduled for today',
            inputSchema: {
              type: 'object',
              properties: {
                include_overdue: {
                  type: 'boolean',
                  description: 'Include overdue tasks',
                  default: true
                }
              }
            }
          },
          {
            name: 'ticktick_get_overdue_tasks',
            description: 'Get all overdue tasks',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of results',
                  default: 50
                }
              }
            }
          },
          {
            name: 'ticktick_get_cached_tasks',
            description: 'Get cached tasks with fresh/stale status',
            inputSchema: {
              type: 'object',
              properties: {
                project_id: {
                  type: 'string',
                  description: 'Filter by project ID'
                }
              }
            }
          },
          {
            name: 'ticktick_complete_task',
            description: 'Mark a task as completed',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: {
                  type: 'string',
                  description: 'ID of the task to complete'
                }
              },
              required: ['task_id']
            }
          },
          {
            name: 'ticktick_update_task',
            description: 'Update an existing task',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: {
                  type: 'string',
                  description: 'ID of the task to update'
                },
                title: {
                  type: 'string',
                  description: 'New task title'
                },
                content: {
                  type: 'string',
                  description: 'New task description'
                },
                priority: {
                  type: 'number',
                  description: 'New priority level'
                },
                due_date: {
                  type: 'string',
                  description: 'New due date'
                },
                completed: {
                  type: 'boolean',
                  description: 'Mark as completed/incomplete'
                }
              },
              required: ['task_id']
            }
          },
          {
            name: 'ticktick_delete_task',
            description: 'Delete a task from TickTick',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: {
                  type: 'string',
                  description: 'ID of the task to delete'
                }
              },
              required: ['task_id']
            }
          }
        ]
      };
    });

    // Здесь должны быть остальные handlers для CallToolRequestSchema...
    // Для краткости показываю только основную структуру
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        // Имитация обработки инструментов - в реальном коде здесь весь ваш существующий функционал
        const result = `Mock result for ${name} with args: ${JSON.stringify(args)}`;
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, result }, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error.message}`
        );
      }
    });
  }

  // Добавляем метод для простого доступа к обработке запросов
  async handleRequest(params) {
    if (params.method === 'tools/list') {
      return await this.server.requestHandlers.get('tools/list')?.({ params: {} });
    } else if (params.method === 'tools/call') {
      return await this.server.requestHandlers.get('tools/call')?.({ params });
    }
    throw new Error(`Unsupported method: ${params.method}`);
  }

  async run() {
    // Create Express app
    const app = express();
    app.use(express.json());
    
    // ============ GENSPARK INTEGRATION ============
    
    // Health check endpoint
    app.get('/', (req, res) => {
      res.json({ 
        status: 'running',
        service: 'TickTick Genspark MCP Server',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        port: 8007,
        endpoints: [
          'GET / - Health check',
          'POST /mcp/tools - List tools',
          'POST /mcp/call/:toolName - Execute tool',
          'GET /api/projects - Quick projects',
          'POST /api/tasks - Create task',
          'GET /api/tasks/today - Today tasks',
          'GET /api/tasks/overdue - Overdue tasks',
          'GET /api/tasks/cached - Cached tasks'
        ]
      });
    });

    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // MCP tools endpoint - список всех доступных инструментов
    app.post('/mcp/tools', async (req, res) => {
      try {
        const toolsResponse = await this.handleRequest({
          method: 'tools/list',
          params: {}
        });

        const tools = toolsResponse?.tools || [];
        
        res.json({ tools });
        
      } catch (error) {
        console.error('Error getting tools:', error);
        res.status(500).json({ 
          success: false,
          error: 'Failed to get tools: ' + error.message 
        });
      }
    });

    // MCP tool execution endpoint  
    app.post('/mcp/call/:toolName', async (req, res) => {
      const { toolName } = req.params;
      const { arguments: args } = req.body;
      
      try {
        const mcpResponse = await this.handleRequest({
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args || {}
          }
        });
        
        // Конвертируем MCP ответ в Genspark формат
        let result;
        if (mcpResponse?.content?.[0]?.text) {
          try {
            result = JSON.parse(mcpResponse.content[0].text);
          } catch {
            result = mcpResponse.content[0].text;
          }
        } else {
          result = mcpResponse;
        }
        
        res.json({ 
          success: true,
          result: result
        });
        
      } catch (error) {
        console.error(`Error executing ${toolName}:`, error.message);
        res.status(500).json({ 
          success: false,
          error: error.message,
          toolName 
        });
      }
    });

    // Quick API endpoints
    app.get('/api/projects', async (req, res) => {
      try {
        const result = await this.handleRequest({
          method: 'tools/call',
          params: {
            name: 'ticktick_get_projects',
            arguments: {}
          }
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/tasks', async (req, res) => {
      try {
        const result = await this.handleRequest({
          method: 'tools/call',
          params: {
            name: 'ticktick_create_task',
            arguments: req.body
          }
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/tasks/today', async (req, res) => {
      try {
        const result = await this.handleRequest({
          method: 'tools/call',
          params: {
            name: 'ticktick_get_today_tasks',
            arguments: req.query
          }
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/tasks/cached', async (req, res) => {
      try {
        const result = await this.handleRequest({
          method: 'tools/call',
          params: {
            name: 'ticktick_get_cached_tasks',
            arguments: req.query
          }
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // ============ ORIGINAL MCP ENDPOINT ============
    
    // Original MCP endpoint (сохраняем для совместимости)
    app.post('/mcp', async (req, res) => {
      try {
        const transport = new StreamableHTTPServerTransport(req, res);
        await this.server.connect(transport);
      } catch (error) {
        console.error('MCP request error:', error);
        res.status(500).json({ 
          jsonrpc: "2.0", 
          error: { code: -32000, message: error.message }, 
          id: req.body?.id || null 
        });
      }
    });

    // Start the server
    const PORT = process.env.PORT || 8007;
    app.listen(PORT, (error) => {
      if (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
      }
      console.log(`🚀 TickTick Genspark MCP Server listening on port ${PORT}`);
      console.log(`📋 Health check: http://localhost:${PORT}/`);
      console.log(`🔧 MCP Tools: http://localhost:${PORT}/mcp/tools`);
      console.log(`⚡ Quick API: http://localhost:${PORT}/api/projects`);
      console.log(`🎯 Environment: ${TICKTICK_ACCESS_TOKEN ? 'Token configured' : 'NO TOKEN'}`);
    });
    
    console.log('✅ Genspark integration ready!');
    console.log('📡 Server ready for connections...');
  }
}

const server = new TickTickMCPServer();
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
