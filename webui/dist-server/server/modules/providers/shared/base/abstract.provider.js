/**
 * Shared provider base.
 *
 * Concrete providers expose their live runtime plus model, auth, MCP, skill,
 * session, and synchronization facets behind one registry-owned object.
 */
export class AbstractProvider {
    id;
    constructor(id) {
        this.id = id;
    }
}
//# sourceMappingURL=abstract.provider.js.map