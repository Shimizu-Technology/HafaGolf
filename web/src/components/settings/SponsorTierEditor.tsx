import type React from 'react';
import { GripVertical, Plus, X } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SponsorTierDef } from './settingsForm';

const SortableTierItem: React.FC<{
  tier: SponsorTierDef;
  canDelete: boolean;
  onLabelChange: (key: string, label: string) => void;
  onDelete: (key: string) => void;
}> = ({ tier, canDelete, onLabelChange, onDelete }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tier.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 bg-gray-50 rounded-xl p-2.5 sm:p-3 ${isDragging ? 'shadow-lg ring-2 ring-brand-300' : ''}`}
    >
      <button
        type="button"
        aria-label={`Reorder ${tier.label}`}
        className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center touch-none p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing flex-shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <input
        type="text"
        aria-label={`Name for ${tier.label}`}
        value={tier.label}
        onChange={(e) => onLabelChange(tier.key, e.target.value)}
        className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      {canDelete && (
        <button
          type="button"
          aria-label={`Remove ${tier.label}`}
          onClick={() => onDelete(tier.key)}
          className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export const SponsorTierEditor: React.FC<{
  tiers: SponsorTierDef[];
  onChange: (tiers: SponsorTierDef[]) => void;
}> = ({ tiers, onChange }) => {
  const sensors = useSensors(
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const sorted = [...tiers].sort((a, b) => a.sort_order - b.sort_order);
  const tierKeys = sorted.map(t => t.key);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sorted.findIndex(t => t.key === active.id);
    const newIndex = sorted.findIndex(t => t.key === over.id);
    const reordered = arrayMove(sorted, oldIndex, newIndex).map((t, i) => ({
      ...t,
      sort_order: i,
    }));
    onChange(reordered);
  };

  const handleLabelChange = (key: string, label: string) => {
    onChange(tiers.map(t => (t.key === key ? { ...t, label } : t)));
  };

  const handleDelete = (key: string) => {
    onChange(tiers.filter(t => t.key !== key));
  };

  const handleAdd = () => {
    const maxOrder = Math.max(...tiers.map(t => t.sort_order), -1);
    const existingKeys = tiers.map(t => t.key);
    let newKey = 'custom';
    let suffix = 1;
    while (existingKeys.includes(newKey)) {
      newKey = `custom_${suffix++}`;
    }
    onChange([...tiers, { key: newKey, label: 'New Tier', sort_order: maxOrder + 1 }]);
  };

  return (
    <div>
      <p className="mb-3 text-sm text-gray-600">Change a tier name or drag its handle to reorder it.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tierKeys} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {sorted.map(tier => (
              <SortableTierItem
                key={tier.key}
                tier={tier}
                canDelete={tiers.length > 2}
                onLabelChange={handleLabelChange}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={handleAdd}
        className="mt-3 flex min-h-[48px] items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium"
      >
        <Plus className="w-4 h-4" />
        Add tier
      </button>
    </div>
  );
};
