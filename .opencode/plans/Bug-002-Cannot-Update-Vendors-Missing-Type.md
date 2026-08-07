# Bug Report: Bug 2 - Cannot Update Vendors, Missing "Type"

## Issue Description
Users cannot update vendor information (type, tags) through the application interface. The vendor update functionality is missing from the backend API, and vendor creation doesn't accept type/tag fields.

## Impact
- Vendors cannot be edited after creation
- Vendor type (Individual/Business/Internal) cannot be set or changed
- Vendor tags cannot be added or modified
- AI classification accuracy affected by incomplete vendor data

## Current State Analysis

### Missing Backend Functionality

#### 1. **No UpdateVendor Endpoint**
**File**: `backend/Functions/VendorFunctions.cs`
**Issue**: Only has `CreateVendor` and `DeleteVendor`, missing `UpdateVendor`

**Current Endpoints**:
```csharp
[Function("GetVendors")]     // GET /vendors
[Function("CreateVendor")]   // POST /vendors (only accepts name)
[Function("DeleteVendor")]   // DELETE /vendors/{id}
// MISSING: UpdateVendor
```

#### 2. **VendorService Missing Update Method**
**File**: `backend/Services/VendorService.cs`
**Issue**: Only implements `CreateVendorAsync` and `DeleteVendorAsync`

**Current Interface Implementation**:
```csharp
public interface IVendorService
{
    Task<IEnumerable<Vendor>> GetVendorsAsync(string userId);
    Task<Vendor?> GetVendorByNameAsync(string userId, string name);
    Task<Vendor> CreateVendorAsync(string userId, string name);  // Only accepts name!
    Task DeleteVendorAsync(string userId, string id);
    Task EnsureVendorAndLookupsAsync(string userId, string vendorName, IEnumerable<string> lookups);
}
```

#### 3. **CreateVendor Only Accepts Name**
**File**: `backend/Services/VendorService.cs:33-49`
**Issue**: `CreateVendorAsync` method signature only accepts `name` parameter, not full `Vendor` object

```csharp
public async Task<Vendor> CreateVendorAsync(string userId, string name)
{
    // Only creates vendor with name, no type or tags!
    var vendor = new Vendor
    {
        UserId = userId,
        Name = name.Trim(),
        Tags = new List<string>()  // Always empty, no tags parameter
        // Type is never set (remains null)
    };
}
```

#### 4. **IVendorService Interface Missing Update**
**File**: `backend/Interfaces/IVendorService.cs`
**Issue**: Interface doesn't define `UpdateVendorAsync` method

### Frontend Limitations

#### 1. **EditVendorModal Has No API**
**File**: `frontend/src/components/EditVendorModal.tsx`
**Issue**: Uses `useUpdateVendor` hook but no backend endpoint exists

```typescript
// In EditVendorModal.tsx:25-29
updateMutation.mutate(formData, {
  onSuccess: () => {
    onClose()
  }
})
```

#### 2. **useUpdateVendor Hook Points to Non-existent Endpoint**
**File**: `frontend/src/hooks/useVendors.ts:47-58`
**Issue**: Hook calls `PUT /vendors/{vendor.id}` but endpoint doesn't exist

```typescript
export function useUpdateVendor() {
  return useMutation({
    mutationFn: async (vendor: Vendor) => {
      const response = await apiClient.put(`/vendors/${vendor.id}`, vendor)
      return response.data as Vendor
    },
    // This will always fail with 404!
  })
}
```

#### 3. **Vendor Model Has Type/Tags But No Way to Set Them**
**File**: `backend/Models/Vendor.cs`
**Issue**: Model has properties but no API to update them

```csharp
public class Vendor
{
    public string Id { get; set; } = Guid.CreateVersion7().ToString();
    public string UserId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public VendorType? Type { get; set; }  // Can be Individual/Business/Internal
    private List<string>? _tags = new();
    public List<string> Tags  // Can store tags but no way to set them
    { 
        get => _tags ??= new(); 
        set => _tags = value ?? new(); 
    }
}
```

## Root Cause

### Primary Issue:
The vendor management system was designed as a simple lookup system but evolved to need full CRUD operations. The initial implementation only supported:
1. Getting vendors (for dropdowns)
2. Creating vendors (name only)
3. Deleting vendors

### Missing Evolution:
When vendor type and tags were added to the model, the corresponding API endpoints weren't created.

### Specific Gaps:
1. **No `UpdateVendor` Azure Function**
2. **No `UpdateVendorAsync` service method**
3. **No PUT route handler for `/vendors/{id}`**
4. **Create method doesn't accept type/tags**
5. **Frontend assumes backend supports updates**

## Reproduction Steps

### Attempting to Edit Vendor:
1. Navigate to Settings → Vendors
2. Click "Edit" on any vendor
3. Change vendor type or add tags
4. Click "Save Changes"
5. **Result**: API error (404 or 405)

### Attempting to Create Vendor with Type/Tags:
1. Open Add Transaction Modal
2. Type new vendor name in combobox
3. Select "Create 'VendorName'"
4. **Result**: Vendor created with default type (null) and empty tags

## Proposed Fixes

### Backend Implementation Required:

#### 1. **Add UpdateVendor Function**
**File**: `backend/Functions/VendorFunctions.cs`
```csharp
[Function("UpdateVendor")]
public async Task<IActionResult> UpdateVendor(
    [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "vendors/{id}")] HttpRequest req, 
    FunctionContext context,
    string id)
{
    string? userId = context.GetUserId();
    if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
    
    var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
    var vendor = JsonSerializer.Deserialize<Vendor>(requestBody, _jsonOptions);
    
    if (vendor == null)
        return new BadRequestObjectResult("Invalid vendor data.");
    
    vendor.Id = id;
    var updatedVendor = await _vendorService.UpdateVendorAsync(userId, vendor);
    return new OkObjectResult(updatedVendor);
}
```

#### 2. **Add UpdateVendorAsync to VendorService**
**File**: `backend/Services/VendorService.cs`
```csharp
public async Task<Vendor> UpdateVendorAsync(string userId, Vendor vendor)
{
    vendor.UserId = userId;
    await _repository.UpdateVendorAsync(vendor);
    await _repository.SaveChangesAsync();
    return vendor;
}
```

#### 3. **Update IVendorService Interface**
**File**: `backend/Interfaces/IVendorService.cs`
```csharp
public interface IVendorService
{
    Task<IEnumerable<Vendor>> GetVendorsAsync(string userId);
    Task<Vendor?> GetVendorByNameAsync(string userId, string name);
    Task<Vendor> CreateVendorAsync(string userId, string name);
    Task<Vendor> UpdateVendorAsync(string userId, Vendor vendor);  // NEW
    Task DeleteVendorAsync(string userId, string id);
    Task EnsureVendorAndLookupsAsync(string userId, string vendorName, IEnumerable<string> lookups);
}
```

#### 4. **Enhance CreateVendor to Accept Full Object**
**File**: `backend/Services/VendorService.cs`
```csharp
// Option A: Overload method
public async Task<Vendor> CreateVendorAsync(string userId, Vendor vendor)
{
    vendor.UserId = userId;
    vendor.Id = Guid.CreateVersion7().ToString();
    await _repository.AddVendorAsync(vendor);
    return vendor;
}

// Option B: Update existing method signature
public async Task<Vendor> CreateVendorAsync(string userId, string name, VendorType? type = null, List<string>? tags = null)
```

### Frontend Updates Required:

#### 1. **Fix Create Vendor in Transaction Modal**
**File**: `frontend/src/components/AddTransactionModal.tsx:1004`
```typescript
// Current (line 1004):
createVendorMutation.mutate({ name: val, type: suggestedVendorType, tags }, {

// This currently calls POST /vendors with full object
// But backend only accepts { name: string }
// Need to update backend to accept full Vendor object
```

## Testing Requirements

### Backend Tests:
1. **UpdateVendor Endpoint**: PUT `/vendors/{id}` returns 200 with updated vendor
2. **CreateVendor with Type/Tags**: POST `/vendors` accepts full vendor object
3. **Validation**: Invalid vendor data returns 400
4. **Authorization**: Missing userId returns 401

### Frontend Tests:
1. **EditVendorModal**: Successfully saves vendor updates
2. **Create Vendor in Transaction**: Creates vendor with correct type/tags
3. **Error Handling**: Displays appropriate errors for failed updates
4. **State Updates**: Vendor list refreshes after updates

### Integration Tests:
1. **Full Flow**: Edit vendor → Save → Verify update in dropdown
2. **Create Flow**: New vendor with type/tags → Appears in combobox
3. **Delete Flow**: Delete vendor → Removed from all interfaces

## Priority: CRITICAL
- Vendor management is completely broken
- AI classification depends on vendor type/tags
- Users cannot correct vendor information
- Workaround: Direct database editing (not acceptable)

## Resolution: FIXED

### Changes Made:

#### Backend - New Endpoints & Methods

**`VendorFunctions.cs`:**
- Added `UpdateVendor` endpoint (`PUT /vendors/{id}`) for editing existing vendors
- Enhanced `CreateVendor` to accept `type` and `tags` from request body
- Added default `VendorType.Business` when type is not provided

**`IVendorService.cs` + `VendorService.cs`:**
- Added `CreateOrUpdateVendorAsync(string userId, Vendor vendor)` — creates new or updates existing by name
- Added `UpdateVendorAsync(string userId, Vendor vendor)` — updates existing vendor with duplicate name check
- Both methods enforce `VendorType.Business` as default if null

**`IVendorRepository.cs` + `VendorRepository.cs`:**
- Added `UpdateVendorAsync(string userId, Vendor vendor)` using `FirstOrDefaultAsync` with `WithPartitionKey(userId)`
- Fixed partition key issue (was causing `FindAsync` composite key error)

#### Frontend

**`EditVendorModal.tsx`:**
- When loading vendor data, defaults `type` to `'Business'` if null so payload always includes valid type
- Defaults `tags` to empty array if null

**`AddTransactionModal.tsx`:**
- Advanced mode now sends selected `vendor` instead of hardcoded `null`
- Auto-creates vendor with `type` and `tags` when saving if vendor not in `dbVendors` list

### Files Modified:
1. `backend/Functions/VendorFunctions.cs` — New UpdateVendor endpoint + CreateVendor enhancement
2. `backend/Interfaces/IVendorService.cs` — Added 2 new interface methods
3. `backend/Services/VendorService.cs` — Implemented CreateOrUpdate + Update methods
4. `backend/Interfaces/IVendorRepository.cs` — Added Update method
5. `backend/Repositories/VendorRepository.cs` — Implemented partition-key-aware update
6. `frontend/src/components/EditVendorModal.tsx` — Default type/tags on load
7. `frontend/src/components/AddTransactionModal.tsx` — Vendor handling in Advanced mode

### Build Status: ✅ Passed (0 errors, 1 pre-existing warning)