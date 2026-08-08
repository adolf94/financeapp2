import { useState, useRef, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { FileText, Code, Edit3, Bold, Italic, Heading2, Heading3, List, Save } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { EnhancedDiffViewer } from '../ui/EnhancedDiffViewer'
import { RunbookSectionNavigator } from './RunbookSectionNavigator'
import { useUpdateRunbookSession } from '@/hooks/useRunbookReview'
import { toast } from 'react-hot-toast'

interface RunbookEditorPanelProps {
  currentRunbook: string
  proposedRunbook: string
  sessionActive: boolean
}

type TabMode = 'edit' | 'preview' | 'diff'

export function RunbookEditorPanel({ currentRunbook, proposedRunbook, sessionActive }: RunbookEditorPanelProps) {
  const [tab, setTab] = useState<TabMode>('edit')
  const [content, setContent] = useState(proposedRunbook)
  const editorRef = useRef<any>(null)
  
  const updateSession = useUpdateRunbookSession()

  // Sync content with props if proposedRunbook changes externally (e.g. from chat)
  useEffect(() => {
    setContent(proposedRunbook)
  }, [proposedRunbook])

  // Debounced auto-save
  useEffect(() => {
    if (!sessionActive || content === proposedRunbook) return

    const timer = setTimeout(() => {
      updateSession.mutate({ proposed_runbook: content })
    }, 1500)

    return () => clearTimeout(timer)
  }, [content, proposedRunbook, sessionActive])

  const handleManualSave = async () => {
    if (!sessionActive) return
    try {
      await updateSession.mutateAsync({ proposed_runbook: content })
      toast.success('Draft saved successfully!')
    } catch {
      toast.error('Failed to save draft.')
    }
  }

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor
  }

  const handleSectionClick = (section: { lineIndex: number }) => {
    setTab('edit')
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.revealLineInCenter(section.lineIndex + 1)
        editorRef.current.setPosition({ lineNumber: section.lineIndex + 1, column: 1 })
        editorRef.current.focus()
      }
    }, 100)
  }

  const insertFormatting = (type: 'bold' | 'italic' | 'h2' | 'h3' | 'list') => {
    if (!editorRef.current) return
    const selection = editorRef.current.getSelection()
    const model = editorRef.current.getModel()
    if (!selection || !model) return

    const selectedText = model.getValueInRange(selection)
    let replacement = ''

    switch (type) {
      case 'bold':
        replacement = `**${selectedText || 'bold text'}**`
        break
      case 'italic':
        replacement = `*${selectedText || 'italic text'}*`
        break
      case 'h2':
        replacement = `\n## ${selectedText || 'Heading 2'}\n`
        break
      case 'h3':
        replacement = `\n### ${selectedText || 'Heading 3'}\n`
        break
      case 'list':
        replacement = `\n- ${selectedText || 'list item'}\n`
        break
    }

    editorRef.current.executeEdits('toolbar', [
      {
        range: selection,
        text: replacement,
        forceMoveMarkers: true,
      },
    ])
    editorRef.current.focus()
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-neutral-950">
      {/* Left Navigation: Section Navigator */}
      <div className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-neutral-800 p-4 shrink-0 flex flex-col h-48 lg:h-full">
        <RunbookSectionNavigator content={content} onSectionClick={handleSectionClick} />
      </div>

      {/* Right Main Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor Toolbar & Tabs Header */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-3 border-b border-neutral-800 bg-neutral-900 gap-2 shrink-0">
          {/* Format Toolbar (only visible in edit mode) */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {tab === 'edit' ? (
              <>
                <button
                  onClick={() => insertFormatting('bold')}
                  className="p-1.5 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
                  title="Bold"
                >
                  <Bold className="w-4 h-4" />
                </button>
                <button
                  onClick={() => insertFormatting('italic')}
                  className="p-1.5 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
                  title="Italic"
                >
                  <Italic className="w-4 h-4" />
                </button>
                <button
                  onClick={() => insertFormatting('h2')}
                  className="p-1.5 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
                  title="Heading 2"
                >
                  <Heading2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => insertFormatting('h3')}
                  className="p-1.5 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
                  title="Heading 3"
                >
                  <Heading3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => insertFormatting('list')}
                  className="p-1.5 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
                  title="Bullet List"
                >
                  <List className="w-4 h-4" />
                </button>
                <div className="w-px h-5 bg-neutral-800 mx-1 shrink-0" />
              </>
            ) : null}
            {sessionActive && (
              <button
                onClick={handleManualSave}
                disabled={updateSession.isPending}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/40 border border-indigo-900/40 rounded transition-colors disabled:opacity-40"
              >
                <Save className="w-3.5 h-3.5" />
                {updateSession.isPending ? 'Saving...' : 'Save Draft'}
              </button>
            )}
          </div>

          {/* Mode Tabs */}
          <div className="flex bg-neutral-950 rounded-lg p-0.5 border border-neutral-800 shrink-0 self-end sm:self-auto">
            <button
              onClick={() => setTab('edit')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
                tab === 'edit'
                  ? 'bg-neutral-800 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={() => setTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
                tab === 'preview'
                  ? 'bg-neutral-800 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Preview
            </button>
            <button
              onClick={() => setTab('diff')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
                tab === 'diff'
                  ? 'bg-neutral-800 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              Diff
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
          {tab === 'edit' ? (
            <Editor
              height="100%"
              language="markdown"
              theme="vs-dark"
              value={content}
              onChange={(val) => setContent(val || '')}
              onMount={handleEditorDidMount}
              options={{
                minimap: { enabled: true },
                wordWrap: 'on',
                fontSize: 14,
                lineNumbers: 'on',
                folding: true,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          ) : tab === 'preview' ? (
            <div className="p-6 prose prose-invert max-w-none prose-sm overflow-auto h-full bg-neutral-950 text-neutral-300">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          ) : (
            <div className="p-4 h-full overflow-hidden">
              <EnhancedDiffViewer oldText={currentRunbook} newText={content} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
