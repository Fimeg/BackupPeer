# BackupPeer Design Considerations

*Issues, improvements, and design decisions tracked during development*

## Current P2P Connection Issues (Identified 2025-07-25)

### 🚨 Major UX Problems

#### 1. **Backwards Workflow**
- **Current**: Users select files first, then blindly match with any peer
- **Problem**: No way to verify who you're connecting to before sharing data
- **Solution**: Establish peer relationship first, then share files

#### 2. **Blind Auto-Matching** 
- **Current**: First available peer with similar storage is auto-matched
- **Problem**: No peer selection, verification, or choice
- **Security Risk**: Could connect to malicious peer accidentally
- **Solution**: Browse available peers like a marketplace

#### 3. **No Peer Verification**
- **Current**: Auto-connect to first match without confirmation
- **Problem**: No identity verification, trust assessment, or handshake
- **Risk**: Users don't know who has their encrypted data
- **Solution**: Peer authentication and confirmation step

#### 4. **Single Point of Failure**
- **Current**: All peers must connect to one signaling server
- **Problem**: Server downtime breaks entire network
- **Scalability**: Won't handle many concurrent users
- **Solution**: Distributed signaling or backup servers

### 🔧 Technical Improvements Needed

#### 1. **Peer Discovery Redesign**
```javascript
// Current: Immediate auto-matching
backup-peer backup ./files/*  // Connects to first available peer

// Proposed: Peer marketplace
backup-peer browse             // Show available peers
backup-peer host --storage 50GB // Create backup slot
backup-peer connect <peer-id>  // Select specific peer
```

#### 2. **Server Configuration**
- **Current**: Hardcoded `ws://localhost:3000` in multiple files
- **Needed**: Default to `wss://backup01.wiuf.net`
- **Files to update**: `client/lib/p2p.js`, `client/lib/cli.js`

#### 3. **Connection Flow**
```
Current Flow:
User A: backup-peer backup files/* → Auto-match → Transfer

Proposed Flow:
User A: backup-peer browse → Select Peer B → Authenticate → backup files/*
User B: backup-peer host --storage 50GB → Wait for connection → Accept → receive
```

#### 4. **Trust Integration**
- **Current**: Reputation system exists but not used in peer selection
- **Needed**: Show peer trust levels during browsing
- **Enhancement**: Filter peers by minimum trust level

## User Experience Gaps

### 1. **No Session Management**
- Users can't see active connections
- No way to disconnect gracefully
- No connection status visibility

### 2. **Missing Feedback**
- No progress indication during peer discovery
- Unclear when waiting vs. connected
- No connection quality metrics

### 3. **Poor Error Handling**
- Generic error messages
- No retry mechanisms for failed connections
- Difficult to diagnose connection problems

## Security Considerations

### 1. **Signaling Server Trust**
- Server can see peer requirements and matching
- Potential for traffic analysis attacks
- Should minimize metadata exposure

### 2. **Peer Authentication**
- No verification that peer is who they claim to be
- Possible man-in-the-middle during signaling
- Need cryptographic peer identity verification

### 3. **Reputation Gaming**
- Current reputation system can be gamed
- No Sybil attack protection
- Reputation not tied to persistent identity

## Proposed Solutions

### Phase 1: Peer Marketplace
1. **Browse Command**: `backup-peer browse` - List available peers with trust scores
2. **Host Command**: `backup-peer host --storage 50GB --duration 2h` - Create backup slot
3. **Connect Command**: `backup-peer connect <peer-id>` - Select specific peer
4. **Authentication**: Verify peer identity before file transfer

### Phase 2: Enhanced Signaling
1. **Default Server**: Update to `backup01.wiuf.net`
2. **Server Redundancy**: Support multiple signaling servers
3. **Metadata Privacy**: Reduce information exposed to signaling server

### Phase 3: Trust Integration
1. **Trust-based Filtering**: Only show peers above minimum trust threshold
2. **Reputation Display**: Show peer reliability scores in browse list
3. **Connection History**: Track successful connections with specific peers

## Implementation Priority

### High Priority (Before Alpha Release)
- [ ] Peer marketplace/browse system
- [ ] Host backup slot creation
- [ ] Peer selection and authentication
- [ ] Update default server address

### Medium Priority
- [ ] Enhanced error handling and user feedback
- [ ] Connection session management
- [ ] Trust level integration with peer selection

### Low Priority (Future Releases)
- [ ] Multiple signaling server support
- [ ] Advanced reputation features
- [ ] Signaling metadata privacy enhancements

## Testing Scenarios

### Basic Peer Selection
1. User A runs `backup-peer host --storage 50GB`
2. User B runs `backup-peer browse` and sees User A listed
3. User B runs `backup-peer connect <user-a-id>` 
4. Both users authenticate and establish connection
5. User B runs `backup-peer backup files/*` to User A

### Trust-based Selection
1. User has reputation data for multiple peers
2. `backup-peer browse --min-trust 0.8` shows only trusted peers
3. User selects peer with highest reputation score
4. Connection establishes with trusted peer confirmation

### Error Handling
1. Selected peer goes offline during connection
2. Authentication fails with chosen peer
3. Signaling server becomes unavailable
4. System provides clear error messages and recovery options

---

*Last Updated: 2025-07-25*  
*Next Review: After Alpha Testing*