// Group node creator
import { FigmaGroupNode, generateId } from '@html2figma/shared';
import { BaseNodeCreator } from '../base/BaseNodeCreator';

export class GroupCreator extends BaseNodeCreator<FigmaGroupNode, GroupNode> {
    /**
     * Create a Group node from JSON data (only creates the node)
     */
    create(data: FigmaGroupNode): GroupNode {
        try {
            this.validateData(data);
            
            const group = this.figmaApi.createGroup();
            
            return group;
            
        } catch (error) {
            this.handleError(error as Error, 'Group', data);
        }
    }

    /**
     * Set all properties for the group after creation
     */
    setProperties(group: GroupNode, data: FigmaGroupNode): void {
        try {
            // Set base properties (without size)
            this.setBaseProperties(group, data);
            
            // Set group-specific properties
            this.setGroupProperties(group, data);
            
            // Set size properties after other properties
            this.setSizeProperties(group, data);
            
            // Layout positioning is now handled in BaseNodeCreator
            
            this.logCreation('Group', data.name);
            
        } catch (error) {
            throw error;
        }
    }


    /**
     * Set group-specific properties
     */
    private setGroupProperties(group: GroupNode, data: FigmaGroupNode): void {
        // Groups inherit most properties from SceneNode
        // Additional group-specific properties can be set here
        
        // Effects (Groups don't have effects in shared types, skip this)
        // if (data.effects) {
        //     this.setEffects(group, data.effects);
        // }
        
        // Blend mode
        if (data.blendMode) {
            group.blendMode = data.blendMode as any;
        }
        
        // Opacity
        if (data.opacity !== undefined) {
            group.opacity = data.opacity;
        }
    }

    /**
     * Add children to the group
     */
    private addChildren(group: GroupNode, children: any[]): void {
        // Note: In a real implementation, you would need to import other creators
        // and create child nodes recursively. For now, we'll leave this as a placeholder.
        
        // This would typically look like:
        // children.forEach(childData => {
        //     const childNode = NodeCreatorFactory.create(childData, this.figmaApi);
        //     group.appendChild(childNode);
        // });
        
        // Group will have children (not implemented yet)
    }

    /**
     * Create a group from existing nodes
     */
    createFromNodes(nodes: any[], groupName: string = 'Group'): GroupNode {
        const groupData: FigmaGroupNode = {
            id: generateId('grp'),
            name: groupName,
            type: 'GROUP',
            visible: true,
            locked: false,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            children: []
        };

        // Calculate bounding box from nodes
        const bounds = this.calculateBoundingBox(nodes);
        groupData.x = bounds.x;
        groupData.y = bounds.y;
        groupData.width = bounds.width;
        groupData.height = bounds.height;

        const group = this.create(groupData);
        
        // Add existing nodes to the group
        nodes.forEach(node => {
            if (node && typeof node.remove === 'function') {
                // Adjust node position relative to group
                node.x -= bounds.x;
                node.y -= bounds.y;
                (group as any).appendChild(node);
            }
        });

        return group;
    }

    /**
     * Create a group with auto-layout behavior (using frame instead)
     */
    createAutoLayoutGroup(data: FigmaGroupNode, layoutMode: 'HORIZONTAL' | 'VERTICAL' = 'VERTICAL'): any {
        // Groups don't support auto-layout, so we create a frame instead
        // Groups do not support auto-layout, creating a frame instead
        
        const frameData = {
            ...data,
            type: 'FRAME' as const,
            layoutMode: layoutMode,
            clipsContent: false,
            fills: [] // Transparent background
        };
        
        // This would require importing FrameCreator
        // return new FrameCreator(this.figmaApi).create(frameData);
        
        return this.figmaApi.createFrame(); // Placeholder
    }

    /**
     * Ungroup - extract children from group
     */
    ungroup(group: GroupNode): any[] {
        const children: any[] = [];
        
        // Get group position for repositioning children
        const groupX = group.x;
        const groupY = group.y;
        
        // Extract children
        while (group.children.length > 0) {
            const child = group.children[0];
            
            // Adjust child position to world coordinates
            child.x += groupX;
            child.y += groupY;
            
            // Move child to group's parent
            if (group.parent) {
                group.parent.appendChild(child);
            }
            
            children.push(child);
        }
        
        // Remove the empty group
        (group as any).remove();
        
        return children;
    }

    /**
     * Calculate bounding box of multiple nodes
     */
    private calculateBoundingBox(nodes: any[]): { x: number; y: number; width: number; height: number } {
        if (nodes.length === 0) {
            return { x: 0, y: 0, width: 100, height: 100 };
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        nodes.forEach(node => {
            if (node && typeof node.x === 'number' && typeof node.y === 'number') {
                const nodeMinX = node.x;
                const nodeMinY = node.y;
                const nodeMaxX = node.x + (node.width || 0);
                const nodeMaxY = node.y + (node.height || 0);

                minX = Math.min(minX, nodeMinX);
                minY = Math.min(minY, nodeMinY);
                maxX = Math.max(maxX, nodeMaxX);
                maxY = Math.max(maxY, nodeMaxY);
            }
        });

        return {
            x: minX === Infinity ? 0 : minX,
            y: minY === Infinity ? 0 : minY,
            width: maxX === -Infinity ? 100 : maxX - minX,
            height: maxY === -Infinity ? 100 : maxY - minY
        };
    }

    /**
     * Validate group-specific data
     */
    protected validateData(data: FigmaGroupNode): boolean {
        super.validateData(data);
        
        if (data.type !== 'GROUP') {
            throw new Error(`Expected GROUP type, got ${data.type}`);
        }
        
        return true;
    }
}
