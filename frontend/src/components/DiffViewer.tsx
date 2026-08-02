

interface DiffViewerProps {
  oldText: string
  newText: string
}

export function DiffViewer({ oldText, newText }: DiffViewerProps) {
  // A very rudimentary line-by-line diff
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  
  // Just for display, we'll show added and removed lines by comparing line presence
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  
  const removedLines = oldLines.filter(line => !newSet.has(line) && line.trim() !== '')
  const addedLines = newLines.filter(line => !oldSet.has(line) && line.trim() !== '')

  return (
    <div className="flex flex-col gap-4 text-sm font-mono bg-neutral-900 text-neutral-100 p-4 rounded-md overflow-auto max-h-96">
      {removedLines.length > 0 && (
        <div>
          <h4 className="text-red-400 font-bold mb-2">Removed / Changed:</h4>
          {removedLines.map((line, i) => (
            <div key={`rm-${i}`} className="text-red-300 bg-red-900/30 px-2 py-0.5">
              - {line}
            </div>
          ))}
        </div>
      )}
      {addedLines.length > 0 && (
        <div className={removedLines.length > 0 ? "mt-4" : ""}>
          <h4 className="text-green-400 font-bold mb-2">Added / Updated:</h4>
          {addedLines.map((line, i) => (
            <div key={`add-${i}`} className="text-green-300 bg-green-900/30 px-2 py-0.5">
              + {line}
            </div>
          ))}
        </div>
      )}
      {removedLines.length === 0 && addedLines.length === 0 && (
        <div className="text-neutral-400 italic">No significant changes detected.</div>
      )}
    </div>
  )
}
