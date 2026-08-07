# PBI 003: Manual RUNBOOK Editing in Review Chat

## Problem Statement
Users cannot directly edit their RUNBOOK.md file during review sessions. Currently, all changes must go through AI-mediated chat conversations, which is inefficient for:
1. Precise rule definitions requiring exact formatting
2. Simple text corrections
3. Bulk edits or structural changes
4. Power users who understand their classification rules

## Current State Analysis

### RUNBOOK Review Chat System Architecture

**Components**:
- `RunbookReviewModal.tsx` - Main container
- `RunbookChatPanel.tsx` - AI conversation interface
- `RunbookDocumentPanel.tsx` - Document preview/diff view
- `DiffViewer.tsx` - Simple line-based diff visualization

**Workflow**:
1. User corrections collected with `user_why` explanations
2. AI analyzes corrections and proposes RUNBOOK updates
3. User chats with AI to refine proposals
4. User approves changes → applied to RUNBOOK.md

**Limitations**:
- **No Direct Editing**: All changes must go through AI conversation
- **Poor Diff Visualization**: Simple line-based diff without syntax highlighting
- **No Section Management**: Entire document edited as one unit
- **Limited Formatting**: Basic markdown rendering only

## User Stories

### Primary User Story
"As a power user reviewing my classification rules, I want to directly edit the RUNBOOK.md text during review sessions, so I can make precise rule changes without relying on AI interpretation."

### Secondary User Stories
1. "As a technical user, I want syntax highlighting and markdown preview while editing RUNBOOK rules."
2. "As an efficiency-focused user, I want to copy-paste rule templates and modify them directly."
3. "As a detail-oriented user, I want character-level diff viewing to see exact changes."
4. "As a collaborative user, I want to save draft versions of RUNBOOK edits."
5. "As a mobile user, I want responsive editing experience with touch-friendly controls."

## Technical Requirements

### Core Requirements
1. **Dual-Mode Interface**: Chat + Direct Editor tabs
2. **Rich Text Editor**: Monaco Editor for markdown with syntax highlighting
3. **Enhanced Diff View**: Proper diff algorithm with syntax awareness
4. **Section Management**: Collapsible sections, table of contents
5. **Real-time Preview**: Live markdown rendering alongside editor

### Advanced Requirements
1. **Version Control**: Draft saving, compare with previous versions
2. **Validation**: Rule syntax checking, validation warnings
3. **Templates**: Predefined rule templates with placeholders
4. **Collaboration**: Comments, suggestions, multi-user editing
5. **Export/Import**: Save/load RUNBOOK configurations

## Implementation Design

### Architecture Changes

**Current Architecture**:
```
RUNBOOK.md (CosmosDB) ↔ AI Service ↔ Chat UI ↔ User
```

**Proposed Enhanced Architecture**:
```
RUNBOOK.md (CosmosDB) ↔ Enhanced Editor ↔ User
                            ↕
                         AI Service ↔ Chat UI
```

### Component Structure
```
RunbookReviewModal
├── Mode Toggle (Chat/Editor)
├── Chat Panel (existing, enhanced)
└── Editor Panel (new)
    ├── Editor Tabs (Preview/Edit/Diff)
    ├── Monaco Editor (rich markdown editing)
    ├── Section Navigator (collapsible TOC)
    └── Formatting Toolbar
```

### Data Flow Enhancements
1. **Editor Mode**: Load RUNBOOK content into Monaco Editor
2. **Direct Editing**: User makes changes directly in editor
3. **Real-time Diff**: Calculate and display changes as user types
4. **AI Integration**: Option to ask AI for suggestions on selected text
5. **Save Draft**: Store edited version without applying to production
6. **Apply Changes**: Update RUNBOOK.md in CosmosDB when approved

## Implementation Plan

### Phase 1: Foundation (Core Editing)
1. **Add Monaco Editor Integration**
   - Install `@monaco-editor/react` dependency
   - Configure markdown language support
   - Set up theme (dark/light mode)

2. **Create Editor Panel Component**
   - New `RunbookEditorPanel.tsx` component
   - Tab switching (Preview/Edit/Diff)
   - Basic editing functionality

3. **Mode Toggle Integration**
   - Add toggle between Chat and Editor modes
   - Preserve session state between modes
   - Update `RunbookReviewModal` layout

### Phase 2: Enhanced User Experience
1. **Rich Diff Visualization**
   - Replace basic `DiffViewer` with enhanced component
   - Use diff algorithm (Myers or patience diff)
   - Add syntax highlighting to diff view
   - Character-level diff capabilities

2. **Section Management**
   - Parse RUNBOOK markdown structure
   - Create collapsible section navigation
   - Jump-to-section functionality
   - Section-level editing focus

3. **Editor Enhancements**
   - Formatting toolbar (bold, italic, lists, etc.)
   - Keyboard shortcuts for common actions
   - Auto-save draft functionality
   - Search and replace within RUNBOOK

### Phase 3: Advanced Features
1. **AI Integration Enhancements**
   - Context menu: "Ask AI about this section"
   - Inline AI suggestions for selected text
   - Compare AI suggestions with manual edits

2. **Validation & Linting**
   - Rule syntax validation
   - Consistency checks across rules
   - Warning/error highlighting
   - Auto-formatting options

3. **Version Management**
   - Save draft versions
   - Compare with previous versions
   - Version history browsing
   - Rollback capability

4. **Collaboration Features**
   - Comments on specific lines/sections
   - Suggested changes with accept/reject
   - Multi-user editing awareness

## Technical Specifications

### Monaco Editor Configuration
```jsx
import Editor from '@monaco-editor/react';

<Editor
  height="100%"
  language="markdown"
  theme={isDarkMode ? "vs-dark" : "light"}
  value={runbookContent}
  onChange={handleContentChange}
  options={{
    minimap: { enabled: true },
    wordWrap: "on",
    fontSize: 14,
    lineNumbers: "on",
    folding: true,
    scrollBeyondLastLine: false,
    automaticLayout: true,
  }}
/>
```

### Enhanced Diff Implementation
```javascript
// Use a proper diff library
import { diffLines, diffWords } from 'diff';

// Options:
// 1. diff-match-patch (Google) - character level
// 2. jsdiff - line/word level
// 3. react-diff-viewer - React component

// Enhanced diff viewer component should:
// - Show syntax-highlighted diff
// - Allow toggling between character/word/line diff
// - Provide side-by-side or inline view options
// - Include copy/export functionality
```

### Section Parsing Algorithm
```javascript
function parseRunbookSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentSection = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Parse markdown headings (#, ##, ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection) {
        currentSection.endLine = i - 1;
        sections.push(currentSection);
      }
      currentSection = {
        level: headingMatch[1].length,
        title: headingMatch[2],
        startLine: i,
        endLine: lines.length - 1, // placeholder
        content: ''
      };
    }
  }
  
  return sections;
}
```

## Files to Create/Modify

### New Components
1. `frontend/src/components/RunbookReview/RunbookEditorPanel.tsx`
   - Main editor component with Monaco integration
   - Tab management (Preview/Edit/Diff)
   - Toolbar and navigation

2. `frontend/src/components/ui/EnhancedDiffViewer.tsx`
   - Advanced diff visualization
   - Syntax highlighting support
   - Multiple view modes

3. `frontend/src/components/RunbookReview/RunbookSectionNavigator.tsx`
   - Table of contents generation
   - Collapsible section navigation
   - Jump-to-section functionality

### Modified Components
1. `frontend/src/components/RunbookReviewModal.tsx`
   - Add mode toggle (Chat/Editor)
   - Integrate new editor panel
   - Update layout for dual-mode interface

2. `frontend/src/components/RunbookReview/RunbookDocumentPanel.tsx`
   - Enhance with editor capabilities
   - Add real-time preview improvements
   - Integrate with new diff viewer

3. `frontend/src/hooks/useRunbookReview.ts`
   - Add editor-specific mutations
   - Handle draft saving/loading
   - Manage editor session state

### Backend Considerations
1. **New API Endpoints**:
   - `POST /runbook/draft` - Save draft version
   - `GET /runbook/draft/{id}` - Load draft version
   - `POST /runbook/validate` - Validate RUNBOOK syntax
   - `GET /runbook/history` - Get version history

2. **Database Schema Updates**:
   - Add `RunbookDrafts` container in CosmosDB
   - Store draft versions with metadata
   - Track editing sessions and changes

## UI/UX Design Considerations

### Dual-Mode Interface Layout
```
┌─────────────────────────────────────────────────────────────┐
│ Runbook Review                                              │
├─────────────────────────────────────────────────────────────┤
│ [ Chat Mode ]    [ Editor Mode ]    [ Save Draft ] [ Apply ]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Monaco Editor / Enhanced Diff / Markdown Preview           │
│                                                             │
│  Section Navigator | Formatting Tools | Search & Replace    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Responsive Design Requirements
- **Desktop**: Full editor with side-by-side preview
- **Tablet**: Stacked editor/preview with responsive toolbar
- **Mobile**: Simplified interface with focus mode
- **Touch Interactions**: Touch-friendly controls, gesture support

### Accessibility Requirements
- **Screen Reader**: Proper ARIA labels for editor controls
- **Keyboard Navigation**: Full keyboard support for editing
- **Focus Management**: Logical tab order, focus trapping
- **High Contrast**: Support for high contrast themes

## Success Metrics

### Quantitative Metrics
1. **Editing Efficiency**: Reduce time for precise rule edits by 70%
2. **AI Dependency**: Reduce AI-mediated edits by 50%
3. **Error Reduction**: Decrease rule syntax errors by1640%
4. **User Adoption**: 80% of power users adopt direct editing

### Qualitative Metrics
1. **User Satisfaction**: Survey feedback on editing experience
2. **Rule Accuracy**: Improved rule precision and effectiveness
3. **Workflow Integration**: Seamless transition between chat and editor
4. **Learning Curve**: Reduced learning curve for RUNBOOK management

## Risks & Mitigations

### Technical Risks
1. **Performance Impact**: Monaco Editor bundle size (~4MB)
   - Mitigation: Lazy loading, code splitting, CDN loading
2. **State Complexity**: Managing editor, chat, and session states
   - Mitigation: Clear state management patterns, Redux/Context
3. **Data Loss**: Unsaved changes during mode switching
   - Mitigation: Auto-save, draft management, confirmation dialogs

### UX Risks
1. **Feature Overload**: Too many options overwhelming users
   - Mitigation: Progressive disclosure, sensible defaults
2. **Mode Confusion**: Users confused between chat and editor modes
   - Mitigation: Clear visual indicators, onboarding, tooltips
3. **Learning Curve**: Advanced editor features intimidating new users
   - Mitigation: Beginner mode, guided tutorials, help system

### Integration Risks
1. **AI Integration**: Manual edits conflicting with AI suggestions
   - Mitigation: Clear versioning, conflict resolution UI
2. **Backward Compatibility**: Existing workflows breaking
   - Mitigation: Feature flags, gradual rollout, user training
3. **Data Migration**: Existing RUNBOOK content compatibility
   - Mitigation: Validation scripts, migration utilities

## Testing Strategy

### Unit Tests
1. Editor component renders correctly
2. Diff algorithm produces accurate results
3. Section parsing identifies headings correctly
4. Mode switching preserves state appropriately

### Integration Tests
1. Complete editing workflow: Load → Edit → Save → Apply
2. Chat/Editor mode interoperability
3. Draft saving and loading functionality
4. Validation rules correctly identify issues

### Performance Tests
1. Editor load time under 2 seconds
2. Large RUNBOOK files (10k+ lines) performance
3. Memory usage during extended editing sessions
4. Concurrent editing scenarios

### Manual Testing Scenarios
1. **Mobile Testing**: Touch interactions, responsive design
2. **Accessibility Testing**: Screen readers, keyboard navigation
3. **Edge Cases**: Very large files, malformed markdown, network failures
4. **User Acceptance**: Real user testing with feedback collection

## Timeline Estimate
- **Phase 1**: 20-30 hours (Foundation - Core Editing)
- **Phase 2**:16820 hours (Enhanced UX - Diff & Sections)
- **Phase 3**: 30-40 hours (Advanced Features)
- **Total**: 70-90 hours

## Dependencies
1. **Monaco Editor**: `@monaco-editor/react` package integration
2. **Diff Library**: Selection and integration of diff algorithm
3. **Backend APIs**: New endpoints for draft management
4. **Design System**: Consistent UI patterns for editor components
5. **Authentication**: User identification for draft ownership

## Related PBIs
1. **PBI 001**: Make reclassify button bigger
2. **PBI 002**: Edit vendor modal during transaction submission
3. **PBI 004**: Enhanced diff visualization system
4. **PBI 005**: RUNBOOK validation and linting rules
5. **PBI 006**: Collaborative editing features

## Open Questions for Discussion
1. Should we use Monaco Editor or a lighter alternative (CodeMirror)?
2. How should we handle conflicts between manual edits and AI suggestions?
3. What level of version control is needed (Git-like or simpler)?
4. Should editing be real-time collaborative from the start?
5. How to balance power features with simplicity for new users?