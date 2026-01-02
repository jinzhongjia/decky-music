## 文件大小限制

硬性限制：每个文件不超过 300 行代码
建议目标：每个文件 150-200 行代码
超过限制处理：必须拆分为多个文件或提取为独立模块

## 遵守的项目架构

```
src/
├── components/          # 可复用的 UI 组件
│   ├── Button/
│   ├── Input/
│   └── Modal/
├── hooks/              # 自定义 Hooks
│   ├── useApi.ts
│   └── useForm.ts
├── services/           # API 和业务逻辑
│   ├── apiClient.ts
│   └── llmService.ts
├── types/              # TypeScript 类型定义
│   └── index.ts
├── utils/              # 工具函数
│   ├── formatters.ts
│   └── validators.ts
├── constants/          # 常量定义
│   └── config.ts
└── App.tsx             # 主应用组件
```

## TypeScript 使用

必须使用 TypeScript，所有文件使用 .ts 或 .tsx 扩展名

- 严格模式：启用 strict: true

- 类型定义：所有函数参数和返回值必须有明确的类型注解

- 避免 any：除非必要，否则禁止使用 any 类型

### 应该遵守的技术栈

- **前端**: React 19 + TypeScript + Decky UI
- **后端**: Python 3 + asyncio + QQMusicApi
- **构建**: Rollup + Docker
- **包管理**: pnpm

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `UserProfile`, `ChatMessage` |
| 函数/变量 | camelCase | `getUserData`, `isLoading` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `API_TIMEOUT` |
| 类型/接口 | PascalCase | `UserData`, `ApiResponse` |
| 文件 | kebab-case (组件) / camelCase (其他) | `user-profile.tsx`, `apiClient.ts` |

### React 组件规范

#### 函数式组件

```typescript
interface ComponentProps {
  title: string;
  onClose?: () => void;
}

export const MyComponent: React.FC<ComponentProps> = ({ title, onClose }) => {
  // 逻辑代码
  return <div>{title}</div>;
};
```

#### Hooks 使用原则

- 仅在函数式组件或自定义 Hooks 中使用
- 不在条件语句中调用 Hooks
- 自定义 Hooks 命名以 `use` 开头
- 合理使用 `useMemo` 和 `useCallback` 避免不必要的重新渲染

#### 性能优化

```typescript
// 使用 React.memo 包装经常重新渲染的组件
export const OptimizedComponent = React.memo(({ data }: Props) => {
  return <div>{data}</div>;
});

// 使用 useCallback 缓存回调函数
const handleClick = useCallback(() => {
  // 处理逻辑
}, [dependency]);

// 使用 useMemo 缓存计算结果
const memoizedValue = useMemo(() => {
  return expensiveCalculation(data);
}, [data]);
```

## 性能优化清单

| 优化项 | 说明 |
|--------|------|
| 代码分割 | 使用 React.lazy 和 Suspense 进行路由级别代码分割 |
| 列表渲染 | 为列表项添加稳定的 key，使用虚拟化处理大列表 |
| 状态管理 | 避免不必要的全局状态，合理使用 Context 和 Redux |
| 网络请求 | 实现请求缓存、去重和超时控制 |
| 包体积 | 定期检查依赖，移除未使用的库 |
| 渲染优化 | 使用 React.memo、useMemo、useCallback 避免重新渲染 |

### 关键设计模式

#### 1. 前后端通信

前端通过 `@decky/api` 的 `callable` 函数与 Python 后端通信：

```typescript
// src/api/index.ts
export const getSongUrl = callable<[mid: string], SongUrlResponse>("get_song_url");
```

Python 端实现对应方法：

```python
# main.py
async def get_song_url(self, mid: str) -> dict[str, Any]:
    # 实现...
```

## 常见任务指南

### 添加新 API 接口

1. 在 `src/api/index.ts` 定义 callable：

```typescript
export const getSomething = callable<[param: string], ResponseType>("get_something");
```

2. 在 `src/types.d.ts` 定义响应类型（如果需要）

3. 在 `main.py` 实现对应方法：

```python
async def get_something(self, param: str) -> dict[str, Any]:
    try:
        result = await qqmusic_api.something(param)
        return {"success": True, "data": result}
    except Exception as e:
        decky.logger.error(f"操作失败: {e}")
        return {"success": False, "error": str(e)}
```

## 生成代码时的要求

### 必须做

1. **拆分文件**：当功能复杂时，主动拆分为多个文件
2. **类型优先**：先定义类型，再实现逻辑
3. **性能考虑**：在编写代码时考虑性能影响
4. **可读性**：使用有意义的变量名和函数名，前端新手也可以轻松读懂代码
5. **模块化**：提取可复用的逻辑为独立函数或 Hooks
6. **简洁性**: 无用的代码无需保留

### 禁止做

1. **超大文件**：不生成超过 300 行的单个文件
2. **使用 any**：避免使用 TypeScript 的 `any` 类型
3. **硬编码**：不在代码中硬编码配置值或常量
4. **过度注释**：不为显而易见的代码添加注释
5. **忽视性能**：不忽视可能的性能问题
6. **console 日志**：禁止使用 `console.log/warn/error` 等（Steam Deck 无法查看控制台输出）
