# PBI 001: Make Reclassify Button Bigger

## Current State Analysis

### Location & Functionality
- **Component**: `AddTransactionModal.tsx` (lines 685-694)
- **Purpose**: Re-run AI classification for current ingestion
- **Current Size**: Small icon button (`w-4 h-4`, `p-1.5`)
- **Visibility**: Only shows when `ingestion` prop exists
- **Position**: Header button group with refresh and close buttons

### User Experience Issues
1. **Too Small**: Difficult to click/tap on mobile
2. **Low Visibility**: Users may not notice the button
3. **No Visual Hierarchy**: Same size as refresh button despite different importance
4. **Missing Text Label**: Icon-only design unclear for new users

## Implementation Options

### Option 1: Simple Size Increase (Recommended)
```css
/* Current */
className="p-1.5 text-slate-400 hover:text-indigo-600 ..."
<RotateCcw className="w-4 h-4" />

/* Proposed */
className="p-2.5 text-slate-400 hover:text-indigo-600 ..."
<RotateCcw className="w-5 h-5" />
```

### Option 2: Icon + Text Button
```jsx
<button
  className="px-3 py-2 flex items-center gap-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-800"
>
  <RotateCcw className="w-4 h-4" />
  <span className="text-xs font-medium">Reclassify</span>
</button>
```

### Option ";Prominent Button in Review Sidebar
- Add larger button in the notification review section
- Use consistent styling with other action buttons
- Provide clearer loading state feedback

## Recommended Implementation Plan

### Phase 1: Header Button Enhancement (Quick Win)
1. Increase icon size from `w-4 h-4` to `w-5 h-5`
2. Increase padding from `p-1.5` to `p-2.5`
3. Add subtle background color on hover
4. Improve tooltip text

### Phase 2: Review Sidebar Addition
1. Add prominent "Re-run AI Classification" button in review sidebar
2. Position near top of review section
3. Use consistent styling with "Create Vendor" button
4. Add confirmation dialog for awareness

### Phase 3: Accessibility Improvements
1. Add ARIA labels
2. Improve focus states
3. Add keyboard shortcut documentation
4. Enhanced loading state with progress indicator

## Files to Modify

### Primary Changes
1. `frontend/src/components/AddTransactionModal.tsx`
   - Update button styling (lines 685-694)
   - Consider adding new button in review sidebar

### Secondary Considerations
1. `frontend/src/components/ui/Combobox.tsx` (if adding tooltip enhancements)
2. CSS custom properties for consistent sizing

## Technical Specifications

### Button Requirements
- **Minimum Touch Target**: 44px × 44px (WCAG 2.1)
- **Loading State**: Show spinner with disabled state
- **Success Feedback**: Brief confirmation message
- **Error Handling**: Display error message with retry option

### Visual Design
- **Icon Size**: `w-5 h-5` (20px) minimum
- **Padding**: `p-2.5` (10px) minimum
- **Color Scheme**: Use indigo-600/400 for consistency
- **Hover States**: Subtle background color change
- **Focus Ring**: `focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`

## Success Metrics

1. **Usability**: Users can easily find and click the button
2. **Clarity**: Purpose of button is immediately understandable
3. **Performance**: No degradation in modal load time
4. **Accessibility**: WCAG 2.1 AA compliance

## Dependencies & Risks

### Dependencies
1. No backend API changes required
2. No database schema changes
3. Pure frontend UI enhancement

### Risks
1. **Layout Shifts**: Button size increase may cause minor layout changes
2. **Mobile Compatibility**: Ensure touch targets remain adequate
3. **Visual Consistency**: Maintain design language consistency

## Testing Plan

### Unit Tests
1. Button renders with correct props
2. Loading state displays correctly
3. Click handler triggers mutation

### Integration Tests
1. Button appears only when ingestion exists
2. Clicking button calls reclassify API
3. Loading state doesn't interfere with other interactions

### Manual Testing
1. Test on mobile devices
2. Test keyboard navigation
3. Test screen reader compatibility
4. Test with various screen sizes

## Timeline Estimate
- **Phase 1**: 1-2 hours
- **Phase 2**: 2-3 hours
- **Phase 3**: 1-2 hours
- **Total**: 4-7 hours

## Open Questions
1. Should we add text label to the header button?
2. Should the button change color when AI suggestions are updated?
3. Should we add keyboard shortcut (e.g., Ctrl+Shift+R)?
4. Should the button be moved to more prominent location?

## Related PBIs
- PBI 002: Edit vendor modal during transaction submission
- PBI 003: Manual RUNBOOK editing in review chat