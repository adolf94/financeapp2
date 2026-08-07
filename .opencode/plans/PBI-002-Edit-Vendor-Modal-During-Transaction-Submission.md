# PBI 002: Edit Vendor Modal During Transaction Submission

## Problem Statement
Users cannot edit vendor details (type, tags) during transaction submission. Currently, users must:
1. Cancel transaction submission
2. Navigate to Settings → Vendors
3. Edit the vendor
4. Return to transaction submission
5. Re-select the corrected vendor

## Current State Analysis

### Vendor Selection in Transaction Modal
**Location**: `AddTransactionModal.tsx` (lines 993-1013)
- Uses `Combobox` component for vendor selection
- Supports **creation** of new vendors via `onCreate` callback
- **Missing**: Edit capability for existing vendors

### Existing EditVendorModal Component
**Location**: `frontend/src/components/EditVendorModal.tsx`
- **Only accessible from Settings page**
- Complete vendor editing functionality
- Cannot be invoked from transaction submission context

### Vendor Data Flow Issues
1. **Combobox Limitations**: Only supports selection/creation, not editing
2. **Separated Edit Functionality**: Edit modal disconnected from transaction flow
3. **No Context-Aware Editing**: Cannot edit currently selected vendor
4. **Missing Integration**: No connection between combobox and edit modal

## User Stories

### Primary User Story
"As a user submitting a transaction, I want to edit vendor details (type, tags) without leaving the transaction form, so I can correct vendor information during the transaction submission process."

### Secondary User Stories
1. "As a power user, I want to quickly update vendor tags for AI classification accuracy during transaction entry."
2. "As a mobile user, I want to avoid context switching between transaction entry and vendor management."
3. "As an efficiency-focused user, I want to complete vendor corrections as part of my transaction workflow."

## Implementation Requirements

### Functional Requirements
1. **Edit Button Integration**: Add edit button next to vendor combobox
2. **Modal Invocation**: Trigger `EditVendorModal` from transaction context
3. **Context Preservation**: Maintain transaction form state during vendor editing
4. **Real-time Updates**: Update vendor selection after editing
5. **Validation**: Ensure vendor changes don't break transaction validation

### Non-Functional Requirements
1. **Performance**: Modal opens/closes within 200ms
2. **Responsive Design**: Works on mobile devices
3. **Accessibility**: Keyboard navigation, screen reader support
4. **Consistency**: Match existing modal design patterns
5. **Error Handling**: Graceful handling of vendor update failures

## Technical Design

### Architecture Changes
1. **Component Integration**: Connect `EditVendorModal` to `AddTransactionModal`
2. **State Management**: Manage vendor editing state in transaction context
3. **Event Handling**: Handle modal open/close with form preservation

### Component Structure
```
AddTransactionModal
├── Vendor Selection Section
│   ├── Combobox (existing)
│   └── Edit Button (new)
└── EditVendorModal (conditionally rendered)
```

### Data Flow
1. User selects vendor from combobox
2. Edit button appears/enabled for existing vendors
3. Clicking edit button opens `EditVendorModal` with current vendor
4. User edits vendor details and saves
5. Modal closes, vendor list refreshes, combobox updates

## Implementation Plan

### Phase 1: Basic Integration (Core Functionality)
1. **Add Edit Button**: Next to vendor combobox in `AddTransactionModal.tsx`
2. **Modal Integration**: Conditionally render `EditVendorModal` from transaction context
3. **Vendor Data Passing**: Pass selected vendor to edit modal
4. **State Management**: Manage modal open/close state

### Phase 2: Enhanced User Experience
1. **Button States**: Disable edit button when no vendor selected
2. **Loading States**: Show loading indicator during vendor updates
3. **Success Feedback**: Confirmation message on successful edit
4. **Error Handling**: Display errors with retry option

### Phase 3: Advanced Features
1. **Keyboard Shortcuts**: `Ctrl+E` to edit selected vendor
2. **Quick Actions**: Right-click context menu on vendor combobox
3. **Bulk Editing**: Option to edit multiple vendor fields at once
4. **AI Suggestions**: Auto-suggest tags/types based on transaction context

## Files to Modify

### Primary Files
1. `frontend/src/components/AddTransactionModal.tsx`
   - Add edit button next to vendor combobox
   - Integrate `EditVendorModal` component
   - Manage vendor editing state

2. `frontend/src/components/EditVendorModal.tsx`
   - Accept `onSave` callback for post-edit actions
   - Add `onCancel` callback for modal dismissal
   - Return to original transaction context

### Secondary Files
1. `frontend/src/hooks/useVendors.ts`
   - Ensure `useUpdateVendor` hook works correctly
   - Add invalidation for vendor queries

2. `frontend/src/components/ui/Combobox.tsx`
   - Potentially enhance to support edit actions
   - Add edit icon integration

3. `frontend/src/pages/Settings.tsx`
   - Ensure existing functionality remains intact

## API Considerations

### Backend Requirements
1. **Vendor Update Endpoint**: Already exists (`PUT /vendors/{id}`)
2. **Vendor Type/Tags Support**: Needs enhancement (PBI 002b)
3. **Real-time Updates**: WebSocket optional for immediate UI updates

### Frontend API Integration
1. **useUpdateVendor Hook**: Already exists, needs type/tag support
2. **Query Invalidation**: Invalidate vendor queries on update
3. **Optimistic Updates**: Update UI immediately, rollback on error

## UI/UX Design Specifications

### Edit Button Placement
```jsx
<div className="flex gap-2 items-center">
  <Combobox /* existing props */ />
  <button
    onClick={handleEditVendor}
    disabled={!selectedVendorId}
    className="p-2 text-slate-400 hover:text-indigo-600 disabled:opacity-30"
    title="Edit selected vendor"
  >
    <Edit className="w-4 h-4" />
  </button>
</div>
```

### Modal Integration
```jsx
{/* In AddTransactionModal render */}
{selectedVendor && isEditVendorModalOpen && (
  <EditVendorModal
    isOpen={isEditVendorModalOpen}
    onClose={() => setIsEditVendorModalOpen(false)}
    vendor={selectedVendor}
    onSave={(updatedVendor) => {
      // Update local state
      // Refresh vendor list
      // Update combobox selection
    }}
  />
)}
```

## Success Metrics

### Quantitative Metrics
1. **Time to Edit**: Reduce vendor edit time from 30s to 5s
2. **Context Switches**: Eliminate 3+ page navigations per edit
3. **Completion Rate**: Increase transaction completion rate by 15%

### Qualitative Metrics
1. **User Satisfaction**: Survey feedback on workflow efficiency
2. **Error Reduction**: Fewer vendor-related transaction errors
3. **Adoption Rate**: Percentage of users using inline edit feature

## Risks & Mitigations

### Technical Risks
1. **State Management Complexity**: Form state preservation during modal
   - Mitigation: Use React state with careful lifecycle management
2. **Performance Impact**: Modal rendering affecting transaction form
   - Mitigation: Lazy load edit modal component
3. **API Consistency**: Vendor updates affecting other parts of system
   - Mitigation: Comprehensive testing of vendor update scenarios

### UX Risks
1. **Modal Overload**: Too many modals confusing users
   - Mitigation: Clear visual hierarchy, consistent patterns
2. **Feature Discoverability**: Users not finding edit button
   - Mitigation: Tooltips, onboarding, visual prominence
3. **Workflow Interruption**: Editing breaking transaction flow
   - Mitigation: Seamless transitions, state preservation

## Testing Strategy

### Unit Tests
1. Edit button renders conditionally based on vendor selection
2. Modal opens/closes correctly
3. Vendor data passes correctly to edit modal

### Integration Tests
1. Complete flow: Select vendor → Edit → Save → Update transaction
2. Error handling: Failed vendor update recovery
3. State preservation: Form data maintained during edit

### Manual Testing Scenarios
1. **Mobile Testing**: Touch interactions, responsive design
2. **Accessibility Testing**: Screen readers, keyboard navigation
3. **Edge Cases**: Empty vendors, concurrent edits, network failures

## Timeline Estimate
- **Phase 1**: 8-12 hours (Core functionality)
- **Phase 2**: 4-6 hours (UX enhancements)
- **Phase 3**: 6-10 hours (Advanced features)
- **Total**: 18-28 hours

## Dependencies
1. **PBI 002b**: Vendor type/tag support in backend APIs
2. **Combobox Enhancements**: May require component updates
3. **Design System**: Consistent modal patterns and styling

## Related PBIs
1. **PBI 001**: Make reclassify button bigger
2. **PBI 002b**: Vendor type/tag support in backend
3. **PBI 003**: Manual RUNBOOK editing in review chat
4. **PBI 004**: Transaction form state persistence